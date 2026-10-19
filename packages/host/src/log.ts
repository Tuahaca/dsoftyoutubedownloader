import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The ONLY logging API for the host. stdout carries Native Messaging frames, so logs go to
 * stderr and %LOCALAPPDATA%\ytdl-host\host.log (or ~/.local/state/ytdl-host/host.log).
 */
export function logDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ytdl-host');
  }
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'ytdl-host');
}

let logFile: string | null = null;

function ensureLogFile(): string | null {
  if (logFile !== null) return logFile;
  try {
    const dir = logDir();
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, 'host.log');
  } catch {
    logFile = null;
  }
  return logFile;
}

export function log(level: 'info' | 'warn' | 'error', message: string, extra?: unknown): void {
  const line = `${new Date().toISOString()} [${level}] ${message}${extra === undefined ? '' : ' ' + safeJson(extra)}\n`;
  process.stderr.write(line);
  const file = ensureLogFile();
  if (file) {
    try {
      appendFileSync(file, line);
    } catch {
      // Logging must never crash the host.
    }
  }
}

function safeJson(v: unknown): string {
  if (v instanceof Error) return v.stack ?? v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
