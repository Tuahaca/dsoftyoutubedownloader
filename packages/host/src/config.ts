import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isRecord } from '@ytdl/shared';
import { log } from './log.js';
import { existingFile, which } from './which.js';

export interface HostConfig {
  ytDlpPath: string | null;
  ffmpegPath: string | null;
  /** JS runtime yt-dlp needs for YouTube's player challenges. Optional: yt-dlp also searches PATH. */
  denoPath: string | null;
}

/**
 * Binary locations: host-config.json (written by `npm run host:install`, next to host.cjs)
 * wins, then PATH lookup. Re-resolved on every call so installing yt-dlp later just works.
 */
export function resolveConfig(): HostConfig {
  let fromFile: Record<string, unknown> = {};
  const file = join(dirname(process.argv[1] ?? __filename), 'host-config.json');
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (isRecord(parsed)) fromFile = parsed;
  } catch {
    // Missing config is fine; fall back to PATH.
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  const config: HostConfig = {
    ytDlpPath: existingFile(str(fromFile.ytDlpPath)) ?? which('yt-dlp'),
    ffmpegPath: existingFile(str(fromFile.ffmpegPath)) ?? which('ffmpeg'),
    denoPath: existingFile(str(fromFile.denoPath)) ?? which('deno'),
  };
  if (!config.ytDlpPath) log('warn', 'yt-dlp not found');
  if (!config.ffmpegPath) log('warn', 'ffmpeg not found');
  if (!config.denoPath) log('warn', 'deno not found; YouTube extraction may fail');
  return config;
}

export function defaultOutputDir(): string {
  return join(homedir(), 'Downloads', 'YouTube');
}
