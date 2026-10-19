import type { ErrorCode } from './protocol.js';

export function formatDuration(totalSec: number | null): string {
  if (totalSec === null || !Number.isFinite(totalSec) || totalSec < 0) return '';
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatSpeed(bytesPerSec: number | undefined): string {
  if (bytesPerSec === undefined || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let v = bytesPerSec;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatEta(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec) || sec < 0) return '';
  return formatDuration(sec) + ' left';
}

export function qualityLabel(mode: 'video' | 'audio', height?: number, audioFormat?: string): string {
  if (mode === 'audio') return (audioFormat ?? 'mp3').toUpperCase();
  return height ? `${height}p` : 'Best';
}

/** Messages shown to users for each error code (F8, F9). */
export const FRIENDLY_ERRORS: Record<ErrorCode, string> = {
  INVALID_URL: "That doesn't look like a YouTube video link.",
  INVALID_REQUEST: 'The request was rejected by the helper app.',
  UNAVAILABLE: 'This video is unavailable (removed, members-only or blocked).',
  AGE_RESTRICTED: 'Age-restricted videos are not supported.',
  PRIVATE: 'This video is private.',
  GEO_BLOCKED: "This video isn't available in your country.",
  BOT_CHECK: 'YouTube asked to confirm you are not a bot. Wait a while and try again.',
  LIVE_NOT_SUPPORTED: 'Live streams are not supported.',
  NETWORK: 'Network problem while talking to YouTube. Check your connection and try again.',
  DEPENDENCY_MISSING: 'yt-dlp or ffmpeg is missing. Install them, then restart Chrome.',
  CANCELLED: 'Cancelled.',
  HOST_MISSING: 'The helper app is not installed. Run "npm run host:install", then restart Chrome.',
  HOST_FORBIDDEN: 'The helper app does not trust this extension ID. Run "npm run host:install" again.',
  HOST_DISCONNECTED: 'The helper app stopped unexpectedly.',
  UNKNOWN: 'Something went wrong.',
};
