import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { log } from './log.js';

export type Spawner = (command: string, args: string[]) => ChildProcess;

/** Every child process goes through here: argument array, never a shell. */
export const spawnSafe: Spawner = (command, args) =>
  nodeSpawn(command, args, {
    shell: false,
    windowsHide: true,
    // On POSIX, a new process group lets killTree() take ffmpeg down with yt-dlp.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  });

/** Kills a process and all its children (yt-dlp → ffmpeg). */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      nodeSpawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch (error) {
    log('warn', `killTree(${pid}) failed`, error);
    child.kill();
  }
}

export interface CaptureResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: NodeJS.ErrnoException;
}

/** Runs a short-lived command and collects its output (yt-dlp --version, yt-dlp -J). */
export function runCapture(
  spawner: Spawner,
  command: string,
  args: string[],
  opts: { timeoutMs: number; maxStdoutBytes: number },
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawner(command, args);
    } catch (error) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, spawnError: error as NodeJS.ErrnoException });
      return;
    }
    const out: Buffer[] = [];
    let outBytes = 0;
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, opts.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > opts.maxStdoutBytes) {
        killTree(child);
        return;
      }
      out.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-64 * 1024);
    });
    const finish = (r: CaptureResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    child.on('error', (error: NodeJS.ErrnoException) =>
      finish({ code: null, stdout: '', stderr, timedOut, spawnError: error }),
    );
    child.on('close', (code) => finish({ code, stdout: Buffer.concat(out).toString('utf8'), stderr, timedOut }));
  });
}

/** Splits a stream into lines, calling onLine for each complete one. */
export function onLines(stream: NodeJS.ReadableStream | null | undefined, onLine: (line: string) => void): void {
  if (!stream) return;
  let pending = '';
  stream.on('data', (chunk: Buffer | string) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) if (line) onLine(line);
  });
  stream.on('end', () => {
    if (pending) onLine(pending);
    pending = '';
  });
}
