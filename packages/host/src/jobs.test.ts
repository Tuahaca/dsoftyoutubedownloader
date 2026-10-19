import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostResponse } from '@ytdl/shared';
import type { HostConfig } from './config.js';
import { JobRunner, type JobSpec } from './jobs.js';
import { FILE_PREFIX, FORMAT_PREFIX, PROGRESS_PREFIX } from './ytdlp.js';

vi.mock('./log.js', () => ({ log: () => undefined }));

interface FakeChild extends EventEmitter {
  stdout: PassThrough;
  stderr: PassThrough;
  pid: number;
  args: string[];
}

const tick = () => new Promise((r) => setImmediate(r));

let dir: string;
let sent: HostResponse[];
let children: FakeChild[];
let killed: FakeChild[];
let clock: number;
/** Fake ms elapsed per now() call; above PROGRESS_MIN_INTERVAL_MS means nothing is throttled. */
let clockStep: number;

function makeRunner(config: HostConfig = { ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', denoPath: null }) {
  return new JobRunner({
    spawn: (_cmd, args) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        pid: 1000 + children.length,
        args,
      }) as FakeChild;
      children.push(child);
      return child as unknown as ChildProcess;
    },
    killTree: (child) => {
      const fake = child as unknown as FakeChild;
      killed.push(fake);
      void exit(fake, null);
    },
    send: (m) => sent.push(m),
    getConfig: () => config,
    now: () => (clock += clockStep),
  });
}

async function exit(child: FakeChild, code: number | null, stderr = ''): Promise<void> {
  if (stderr) child.stderr.write(stderr);
  child.stdout.end();
  await tick();
  child.emit('close', code);
  await tick();
}

const spec = (n: number, extra: Partial<JobSpec> = {}): JobSpec => ({
  jobId: `job-${n}`,
  videoId: 'abcdefghijk',
  canonicalUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  mode: 'video',
  height: 1080,
  outputDir: dir,
  ...extra,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ytdl-jobs-'));
  sent = [];
  children = [];
  killed = [];
  clock = 0;
  clockStep = 1000;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('JobRunner', () => {
  it('respects the concurrency limit and starts queued jobs as others finish', async () => {
    const runner = makeRunner();
    runner.setMaxConcurrent(2);
    runner.submit(spec(1));
    runner.submit(spec(2));
    runner.submit(spec(3));
    expect(children).toHaveLength(2);
    expect(runner.activeCount).toBe(3);

    children[0]!.stdout.write(`${FILE_PREFIX}${join(dir, 'a [abcdefghijk].mp4')}\n`);
    await exit(children[0]!, 0);
    expect(children).toHaveLength(3);
    expect(sent).toContainEqual({ id: 'job-1', type: 'done', filePath: join(dir, 'a [abcdefghijk].mp4') });
  });

  it('streams progress and reports done', async () => {
    const runner = makeRunner();
    runner.submit(spec(1));
    const child = children[0]!;
    child.stdout.write(`${FORMAT_PREFIX}137+140\n`);
    child.stdout.write(`${PROGRESS_PREFIX}downloading|50|100|NA|2048|3\n`);
    child.stdout.write(`${PROGRESS_PREFIX}finished|100|100|NA|NA|NA\n`);
    child.stdout.write(`${PROGRESS_PREFIX}downloading|10|10|NA|NA|NA\n`);
    child.stdout.write(`${PROGRESS_PREFIX}finished|10|10|NA|NA|NA\n`);
    child.stdout.write(`${FILE_PREFIX}${join(dir, 'Clip [abcdefghijk].mp4')}\n`);
    await exit(child, 0);

    const progress = sent.filter((m) => m.type === 'progress');
    expect(progress[0]).toEqual({ id: 'job-1', type: 'progress', percent: 0, stage: 'downloading' });
    expect(progress).toContainEqual({ id: 'job-1', type: 'progress', percent: 25, speed: 2048, etaSec: 3, stage: 'downloading' });
    expect(progress.at(-1)).toMatchObject({ stage: 'merging', percent: 99 });
    expect(sent.at(-1)).toEqual({ id: 'job-1', type: 'done', filePath: join(dir, 'Clip [abcdefghijk].mp4') });
  });

  it('throttles progress to one message per interval but always sends stage changes', async () => {
    clockStep = 10;
    const runner = makeRunner();
    runner.submit(spec(1, { mode: 'audio', audioFormat: 'mp3', height: undefined }));
    const child = children[0]!;
    for (let i = 1; i <= 50; i++) child.stdout.write(`${PROGRESS_PREFIX}downloading|${i}|100|NA|NA|NA\n`);
    child.stdout.write(`${PROGRESS_PREFIX}finished|100|100|NA|NA|NA\n`);
    await exit(child, 1, 'ERROR: boom\n');

    const progress = sent.filter((m) => m.type === 'progress');
    // 50 updates 10ms apart = 500ms → initial + ~2 throttled updates + the stage change.
    expect(progress.length).toBeLessThanOrEqual(5);
    expect(progress.at(-1)).toMatchObject({ stage: 'converting' });
  });

  it('passes an argument array that ends with the canonical URL', () => {
    const runner = makeRunner();
    runner.submit(spec(1, { mode: 'audio', audioFormat: 'mp3', height: undefined }));
    expect(children[0]!.args.slice(-2)).toEqual(['--', 'https://www.youtube.com/watch?v=abcdefghijk']);
    expect(children[0]!.args).toContain('--extract-audio');
  });

  it('maps yt-dlp failures to error codes', async () => {
    const runner = makeRunner();
    runner.submit(spec(1));
    await exit(children[0]!, 1, 'ERROR: [youtube] abcdefghijk: Private video. Sign in\n');
    expect(sent.at(-1)).toMatchObject({ id: 'job-1', type: 'error', code: 'PRIVATE' });
  });

  it('cancels a queued job without spawning it', () => {
    const runner = makeRunner();
    runner.setMaxConcurrent(1);
    runner.submit(spec(1));
    runner.submit(spec(2));
    runner.cancel('job-2');
    expect(sent).toContainEqual({ id: 'job-2', type: 'cancelled' });
    expect(children).toHaveLength(1);
  });

  it('cancels a running job, kills its tree and removes only its new files', async () => {
    const old = join(dir, 'Earlier [abcdefghijk].mp4');
    const unrelated = join(dir, 'Other [zzzzzzzzzzz].mp4.part');
    writeFileSync(old, 'keep');
    writeFileSync(unrelated, 'keep');

    const runner = makeRunner();
    runner.submit(spec(1));
    const partial = join(dir, 'Clip [abcdefghijk].f137.mp4.part');
    writeFileSync(partial, 'partial');

    runner.cancel('job-1');
    await tick();
    await tick();

    expect(killed).toHaveLength(1);
    expect(sent.at(-1)).toEqual({ id: 'job-1', type: 'cancelled' });
    expect(existsSync(partial)).toBe(false);
    expect(existsSync(old)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });

  it('reports missing dependencies instead of spawning', () => {
    const runner = makeRunner({ ytDlpPath: 'yt-dlp', ffmpegPath: null, denoPath: null });
    runner.submit(spec(1));
    expect(children).toHaveLength(0);
    expect(sent).toEqual([{ id: 'job-1', type: 'error', code: 'DEPENDENCY_MISSING', message: 'ffmpeg not found' }]);
  });

  it('rejects duplicate job ids', () => {
    const runner = makeRunner();
    runner.submit(spec(1));
    runner.submit(spec(1));
    expect(sent.at(-1)).toMatchObject({ type: 'error', code: 'INVALID_REQUEST' });
  });

  it('cancelAll stops every running job', async () => {
    const runner = makeRunner();
    runner.submit(spec(1));
    runner.submit(spec(2, { videoId: 'bbbbbbbbbbb' }));
    await runner.cancelAll(500);
    expect(killed).toHaveLength(2);
    expect(runner.activeCount).toBe(0);
  });
});
