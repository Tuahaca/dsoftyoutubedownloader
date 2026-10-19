import type { ChildProcess } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROGRESS_MIN_INTERVAL_MS,
  type AudioFormat,
  type ErrorCode,
  type HostResponse,
  type MaxConcurrent,
  type Mode,
  type ProgressStage,
} from '@ytdl/shared';
import type { HostConfig } from './config.js';
import { log } from './log.js';
import { onLines, type Spawner } from './process.js';
import { isInsideDir } from './validate.js';
import { buildDownloadArgs, FILE_PREFIX, mapError, parseProgressLine, ProgressTracker } from './ytdlp.js';

export interface JobSpec {
  jobId: string;
  videoId: string;
  canonicalUrl: string;
  mode: Mode;
  height?: number;
  audioFormat?: AudioFormat;
  outputDir: string;
}

interface RunningJob {
  spec: JobSpec;
  child: ChildProcess;
  cancelled: boolean;
  preexisting: Set<string>;
  closed: Promise<void>;
}

export interface JobRunnerDeps {
  spawn: Spawner;
  killTree: (child: ChildProcess) => void;
  send: (message: HostResponse) => void;
  getConfig: () => HostConfig;
  now?: () => number;
}

/** Queue + concurrency limit + cancel for downloads. One yt-dlp process per running job. */
export class JobRunner {
  private readonly queue: JobSpec[] = [];
  private readonly running = new Map<string, RunningJob>();
  private maxConcurrent: MaxConcurrent = 2;
  private readonly now: () => number;

  constructor(private readonly deps: JobRunnerDeps) {
    this.now = deps.now ?? Date.now;
  }

  setMaxConcurrent(n: MaxConcurrent): void {
    this.maxConcurrent = n;
    this.pump();
  }

  get activeCount(): number {
    return this.running.size + this.queue.length;
  }

  submit(spec: JobSpec): void {
    if (this.running.has(spec.jobId) || this.queue.some((j) => j.jobId === spec.jobId)) {
      this.deps.send({ id: spec.jobId, type: 'error', code: 'INVALID_REQUEST', message: 'Duplicate job id' });
      return;
    }
    const config = this.deps.getConfig();
    if (!config.ytDlpPath || !config.ffmpegPath) {
      const missing = [!config.ytDlpPath && 'yt-dlp', !config.ffmpegPath && 'ffmpeg'].filter(Boolean).join(' and ');
      this.deps.send({ id: spec.jobId, type: 'error', code: 'DEPENDENCY_MISSING', message: `${missing} not found` });
      return;
    }
    this.queue.push(spec);
    this.pump();
  }

  cancel(jobId: string): void {
    const queuedIndex = this.queue.findIndex((j) => j.jobId === jobId);
    if (queuedIndex !== -1) {
      this.queue.splice(queuedIndex, 1);
      this.deps.send({ id: jobId, type: 'cancelled' });
      return;
    }
    const job = this.running.get(jobId);
    if (!job) {
      // Already finished or never existed: cancelling is idempotent.
      this.deps.send({ id: jobId, type: 'cancelled' });
      return;
    }
    job.cancelled = true;
    this.deps.killTree(job.child);
  }

  /** Used on shutdown (Chrome closed the port). Resolves when every child has exited or after timeoutMs. */
  async cancelAll(timeoutMs = 3000): Promise<void> {
    this.queue.length = 0;
    const closing = [...this.running.values()].map((job) => {
      job.cancelled = true;
      this.deps.killTree(job.child);
      return job.closed;
    });
    await Promise.race([Promise.all(closing), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  private pump(): void {
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const spec = this.queue.shift();
      if (spec) this.start(spec);
    }
  }

  private start(spec: JobSpec): void {
    const config = this.deps.getConfig();
    const fail = (code: ErrorCode, message: string) => this.deps.send({ id: spec.jobId, type: 'error', code, message });

    if (!config.ytDlpPath) {
      fail('DEPENDENCY_MISSING', 'yt-dlp not found');
      return;
    }
    try {
      mkdirSync(spec.outputDir, { recursive: true });
    } catch (error) {
      fail('INVALID_REQUEST', `Cannot create output folder: ${(error as Error).message}`);
      return;
    }

    const args = buildDownloadArgs({
      canonicalUrl: spec.canonicalUrl,
      mode: spec.mode,
      height: spec.height,
      audioFormat: spec.audioFormat,
      outputDir: spec.outputDir,
      ffmpegPath: config.ffmpegPath,
      denoPath: config.denoPath,
    });
    log('info', `job ${spec.jobId} start`, { videoId: spec.videoId, mode: spec.mode, height: spec.height, audioFormat: spec.audioFormat });

    const preexisting = this.filesFor(spec);
    let child: ChildProcess;
    try {
      child = this.deps.spawn(config.ytDlpPath, args);
    } catch (error) {
      fail('DEPENDENCY_MISSING', `Could not start yt-dlp: ${(error as Error).message}`);
      return;
    }

    let resolveClosed: () => void = () => {};
    const job: RunningJob = {
      spec,
      child,
      cancelled: false,
      preexisting,
      closed: new Promise<void>((r) => (resolveClosed = r)),
    };
    this.running.set(spec.jobId, job);

    const tracker = new ProgressTracker(spec.mode);
    let filePath: string | null = null;
    let stderr = '';
    let lastSentAt = 0;
    let lastStage: ProgressStage | null = null;
    let spawnError: NodeJS.ErrnoException | null = null;

    const sendProgress = (u: { percent: number; speed?: number; etaSec?: number; stage: ProgressStage }, force = false) => {
      const t = this.now();
      if (!force && u.stage === lastStage && t - lastSentAt < PROGRESS_MIN_INTERVAL_MS) return;
      lastSentAt = t;
      lastStage = u.stage;
      this.deps.send({ id: spec.jobId, type: 'progress', ...u });
    };
    sendProgress({ percent: 0, stage: 'downloading' }, true);

    onLines(child.stdout, (line) => {
      if (line.startsWith(FILE_PREFIX)) {
        filePath = line.slice(FILE_PREFIX.length).trim();
        return;
      }
      tracker.onFormatLine(line);
      const raw = parseProgressLine(line);
      if (raw) sendProgress(tracker.onProgress(raw));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-64 * 1024);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnError = error;
    });
    child.on('close', (code) => {
      this.running.delete(spec.jobId);
      try {
        this.finish(job, code, filePath, stderr, spawnError);
      } finally {
        resolveClosed();
        this.pump();
      }
    });
  }

  private finish(
    job: RunningJob,
    code: number | null,
    filePath: string | null,
    stderr: string,
    spawnError: NodeJS.ErrnoException | null,
  ): void {
    const { spec } = job;
    if (job.cancelled) {
      this.removePartials(job);
      log('info', `job ${spec.jobId} cancelled`);
      this.deps.send({ id: spec.jobId, type: 'cancelled' });
      return;
    }
    if (spawnError) {
      log('error', `job ${spec.jobId} spawn error`, spawnError);
      this.deps.send({ id: spec.jobId, type: 'error', code: 'DEPENDENCY_MISSING', message: `Could not start yt-dlp: ${spawnError.message}` });
      return;
    }
    if (code === 0 && filePath) {
      if (!isInsideDir(spec.outputDir, filePath)) {
        log('warn', `job ${spec.jobId} wrote outside output dir`, { filePath, outputDir: spec.outputDir });
      }
      log('info', `job ${spec.jobId} done`, { filePath });
      this.deps.send({ id: spec.jobId, type: 'done', filePath });
      return;
    }
    const mapped = code === 0 ? { code: 'UNKNOWN' as const, message: 'yt-dlp finished but reported no file' } : mapError(stderr);
    log('error', `job ${spec.jobId} failed (exit ${code})`, { code: mapped.code, stderr: stderr.slice(-2000) });
    this.removePartials(job);
    this.deps.send({ id: spec.jobId, type: 'error', ...mapped });
  }

  /** Names in the output folder that belong to this video ("... [<id>].ext", plus .part etc.). */
  private filesFor(spec: JobSpec): Set<string> {
    try {
      return new Set(readdirSync(spec.outputDir).filter((name) => name.includes(`[${spec.videoId}]`)));
    } catch {
      return new Set();
    }
  }

  /** Deletes only files this job created: new since start, and tagged with this video's id. */
  private removePartials(job: RunningJob): void {
    const { spec } = job;
    const sharedVideo =
      [...this.running.values()].some((j) => j.spec.videoId === spec.videoId) ||
      this.queue.some((j) => j.videoId === spec.videoId);
    if (sharedVideo) {
      log('warn', `job ${spec.jobId}: another job uses the same video, leaving partial files`);
      return;
    }
    for (const name of this.filesFor(spec)) {
      if (job.preexisting.has(name)) continue;
      const full = join(spec.outputDir, name);
      if (!isInsideDir(spec.outputDir, full)) continue;
      try {
        rmSync(full, { force: true });
      } catch (error) {
        log('warn', `could not remove ${full}`, error);
      }
    }
  }
}
