import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { PROBE_CACHE_TTL_MS, type ErrorCode, type HostResponse, type VideoInfo } from '@ytdl/shared';
import { defaultOutputDir, resolveConfig } from './config.js';
import { JobRunner } from './jobs.js';
import { log } from './log.js';
import { killTree, runCapture, spawnSafe } from './process.js';
import { encodeMessage, MessageDecoder } from './stdio.js';
import { validateRequest } from './validate.js';
import { buildProbeArgs, mapError, trimInfo } from './ytdlp.js';

const HOST_VERSION = typeof __HOST_VERSION__ === 'string' ? __HOST_VERSION__ : '0.0.0-dev';

function send(message: HostResponse): void {
  try {
    process.stdout.write(encodeMessage(message));
  } catch (error) {
    log('error', 'failed to send message', error);
    if (message.type !== 'error') {
      send({ id: message.id, type: 'error', code: 'UNKNOWN', message: 'Response too large' });
    }
  }
}

const runner = new JobRunner({ spawn: spawnSafe, killTree, send, getConfig: resolveConfig });

// ---------- hello ----------

let versionCache: { at: number; ytDlpVersion: string | null; ytDlpPath: string | null } | null = null;

async function handleHello(id: string): Promise<void> {
  const config = resolveConfig();
  if (!versionCache || versionCache.ytDlpPath !== config.ytDlpPath || Date.now() - versionCache.at > 60_000) {
    let ytDlpVersion: string | null = null;
    if (config.ytDlpPath) {
      const r = await runCapture(spawnSafe, config.ytDlpPath, ['--version'], { timeoutMs: 15_000, maxStdoutBytes: 4096 });
      if (r.code === 0) ytDlpVersion = r.stdout.trim().split(/\r?\n/)[0] ?? null;
      else log('warn', 'yt-dlp --version failed', { code: r.code, stderr: r.stderr, spawnError: r.spawnError?.message });
    }
    versionCache = { at: Date.now(), ytDlpVersion, ytDlpPath: config.ytDlpPath };
  }
  send({
    id,
    type: 'hello',
    hostVersion: HOST_VERSION,
    ytDlpVersion: versionCache.ytDlpVersion,
    ffmpeg: config.ffmpegPath !== null,
    defaultOutputDir: defaultOutputDir(),
  });
}

// ---------- probe ----------

type ProbeResult = { ok: true; info: VideoInfo } | { ok: false; code: ErrorCode; message: string };

const probeCache = new Map<string, { at: number; info: VideoInfo }>();
const probeInFlight = new Map<string, Promise<ProbeResult>>();

async function probe(videoId: string, canonicalUrl: string): Promise<ProbeResult> {
  const cached = probeCache.get(videoId);
  if (cached && Date.now() - cached.at < PROBE_CACHE_TTL_MS) return { ok: true, info: cached.info };

  const config = resolveConfig();
  if (!config.ytDlpPath) return { ok: false, code: 'DEPENDENCY_MISSING', message: 'yt-dlp not found' };

  const r = await runCapture(spawnSafe, config.ytDlpPath, buildProbeArgs(canonicalUrl, config.denoPath), {
    timeoutMs: 60_000,
    maxStdoutBytes: 64 * 1024 * 1024,
  });
  if (r.spawnError) {
    return { ok: false, code: 'DEPENDENCY_MISSING', message: `Could not start yt-dlp: ${r.spawnError.message}` };
  }
  if (r.timedOut) return { ok: false, code: 'NETWORK', message: 'Timed out fetching video info' };
  if (r.code !== 0) {
    log('warn', `probe ${videoId} failed`, { code: r.code, stderr: r.stderr.slice(-2000) });
    return { ok: false, ...mapError(r.stderr) };
  }
  try {
    const { isLive, ...info } = trimInfo(JSON.parse(r.stdout));
    if (isLive) return { ok: false, code: 'LIVE_NOT_SUPPORTED', message: 'Live streams are not supported' };
    probeCache.set(videoId, { at: Date.now(), info });
    return { ok: true, info };
  } catch (error) {
    log('error', `probe ${videoId}: bad JSON`, error);
    return { ok: false, code: 'UNKNOWN', message: 'Could not read video info from yt-dlp' };
  }
}

async function handleProbe(id: string, videoId: string, canonicalUrl: string): Promise<void> {
  let pending = probeInFlight.get(videoId);
  if (!pending) {
    pending = probe(videoId, canonicalUrl).finally(() => probeInFlight.delete(videoId));
    probeInFlight.set(videoId, pending);
  }
  const result = await pending;
  if (result.ok) send({ id, type: 'info', ...result.info });
  else send({ id, type: 'error', code: result.code, message: result.message });
}

// ---------- reveal ----------

function handleReveal(id: string, filePath: string): void {
  // Windows paths cannot contain quotes; reject them so verbatim quoting below stays safe.
  if (filePath.includes('"')) {
    send({ id, type: 'error', code: 'INVALID_REQUEST', message: 'Invalid path' });
    return;
  }
  const fileExists = existsSync(filePath) && statSync(filePath).isFile();
  const folder = dirname(filePath);
  if (!fileExists && !existsSync(folder)) {
    send({ id, type: 'error', code: 'UNAVAILABLE', message: 'The file no longer exists' });
    return;
  }
  try {
    const child =
      process.platform === 'win32'
        ? nodeSpawn('explorer.exe', [fileExists ? `/select,"${filePath}"` : `"${folder}"`], {
            shell: false,
            windowsVerbatimArguments: true,
            detached: true,
            stdio: 'ignore',
          })
        : process.platform === 'darwin'
          ? nodeSpawn('open', fileExists ? ['-R', filePath] : [folder], { shell: false, detached: true, stdio: 'ignore' })
          : nodeSpawn('xdg-open', [folder], { shell: false, detached: true, stdio: 'ignore' });
    child.on('error', (error) => log('warn', 'reveal failed', error));
    child.unref();
    send({ id, type: 'revealed' });
  } catch (error) {
    log('warn', 'reveal failed', error);
    send({ id, type: 'error', code: 'UNKNOWN', message: 'Could not open the folder' });
  }
}

// ---------- dispatch ----------

function handleMessage(raw: unknown): void {
  const result = validateRequest(raw);
  if (!result.ok) {
    const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : '';
    log('warn', 'rejected request', { code: result.code, message: result.message });
    send({ id, type: 'error', code: result.code, message: result.message });
    return;
  }
  const req = result.value;
  switch (req.type) {
    case 'hello':
      void handleHello(req.id);
      return;
    case 'probe':
      void handleProbe(req.id, req.videoId ?? '', req.url);
      return;
    case 'download':
      if (req.maxConcurrent) runner.setMaxConcurrent(req.maxConcurrent);
      runner.submit({
        jobId: req.id,
        videoId: req.videoId ?? '',
        canonicalUrl: req.url,
        mode: req.mode,
        height: req.mode === 'video' ? req.height : undefined,
        audioFormat: req.mode === 'audio' ? (req.audioFormat ?? 'mp3') : undefined,
        outputDir: req.outputDir || defaultOutputDir(),
      });
      return;
    case 'cancel':
      runner.cancel(req.jobId);
      return;
    case 'reveal':
      handleReveal(req.id, req.filePath);
      return;
  }
}

let shuttingDown = false;
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', `shutting down: ${reason}`);
  await runner.cancelAll();
  process.exit(0);
}

const decoder = new MessageDecoder(handleMessage, (error) => {
  log('error', 'decode error', error);
  if (error.kind === 'too_large') void shutdown('oversized message');
  else send({ id: '', type: 'error', code: 'INVALID_REQUEST', message: 'Invalid JSON' });
});

process.stdin.on('data', (chunk: Buffer) => decoder.push(chunk));
// Chrome closes stdin when the port disconnects (e.g. the extension reloads): stop every download.
process.stdin.on('end', () => void shutdown('stdin closed'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  log('error', 'uncaught exception', error);
  void shutdown('uncaught exception');
});

log('info', `host ${HOST_VERSION} started (node ${process.version}, pid ${process.pid})`);
