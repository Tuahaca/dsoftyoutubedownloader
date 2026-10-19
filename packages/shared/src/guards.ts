import { AUDIO_FORMATS, DEFAULT_SETTINGS, MAX_HEIGHT, MIN_HEIGHT } from './constants.js';
import type {
  AudioFormat,
  ErrorCode,
  HistoryItem,
  HostRequest,
  HostResponse,
  Job,
  MaxConcurrent,
  Mode,
  Settings,
  UiRequest,
} from './protocol.js';

type Rec = Record<string, unknown>;

export function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optional = <T>(v: unknown, guard: (x: unknown) => x is T): boolean => v === undefined || guard(v);

export const isMode = (v: unknown): v is Mode => v === 'video' || v === 'audio';
export const isAudioFormat = (v: unknown): v is AudioFormat =>
  typeof v === 'string' && (AUDIO_FORMATS as readonly string[]).includes(v);
export const isMaxConcurrent = (v: unknown): v is MaxConcurrent => v === 1 || v === 2 || v === 3;
export const isHeight = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= MIN_HEIGHT && v <= MAX_HEIGHT;

const ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  'INVALID_URL',
  'INVALID_REQUEST',
  'UNAVAILABLE',
  'AGE_RESTRICTED',
  'PRIVATE',
  'GEO_BLOCKED',
  'BOT_CHECK',
  'LIVE_NOT_SUPPORTED',
  'NETWORK',
  'DEPENDENCY_MISSING',
  'CANCELLED',
  'HOST_MISSING',
  'HOST_FORBIDDEN',
  'HOST_DISCONNECTED',
  'UNKNOWN',
]);
export const isErrorCode = (v: unknown): v is ErrorCode => typeof v === 'string' && ERROR_CODES.has(v);

/** Validates a message arriving at the host from the extension. */
export function isHostRequest(v: unknown): v is HostRequest {
  if (!isRecord(v) || !isNonEmptyString(v.id) || v.id.length > 64) return false;
  switch (v.type) {
    case 'hello':
      return true;
    case 'probe':
      return isNonEmptyString(v.url);
    case 'download':
      return (
        isNonEmptyString(v.url) &&
        isMode(v.mode) &&
        optional(v.height, isHeight) &&
        optional(v.audioFormat, isAudioFormat) &&
        optional(v.outputDir, isString) &&
        optional(v.maxConcurrent, isMaxConcurrent)
      );
    case 'cancel':
      return isNonEmptyString(v.jobId);
    case 'reveal':
      return isNonEmptyString(v.filePath);
    default:
      return false;
  }
}

/** Validates a message arriving at the extension from the host. */
export function isHostResponse(v: unknown): v is HostResponse {
  if (!isRecord(v) || !isString(v.id)) return false;
  switch (v.type) {
    case 'hello':
      return (
        isString(v.hostVersion) &&
        (v.ytDlpVersion === null || isString(v.ytDlpVersion)) &&
        typeof v.ffmpeg === 'boolean' &&
        isString(v.defaultOutputDir)
      );
    case 'info':
      return (
        isNonEmptyString(v.videoId) &&
        isString(v.title) &&
        isString(v.channel) &&
        (v.durationSec === null || isFiniteNumber(v.durationSec)) &&
        (v.thumbnailUrl === null || isString(v.thumbnailUrl)) &&
        Array.isArray(v.heights) &&
        v.heights.every(isFiniteNumber)
      );
    case 'progress':
      return (
        isFiniteNumber(v.percent) &&
        optional(v.speed, isFiniteNumber) &&
        optional(v.etaSec, isFiniteNumber) &&
        (v.stage === 'downloading' || v.stage === 'merging' || v.stage === 'converting')
      );
    case 'done':
      return isNonEmptyString(v.filePath);
    case 'cancelled':
    case 'revealed':
      return true;
    case 'error':
      return isErrorCode(v.code) && isString(v.message);
    default:
      return false;
  }
}

/** Validates a message arriving at the service worker from the popup/options page. */
export function isUiRequest(v: unknown): v is UiRequest {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'hello':
    case 'popupOpened':
      return true;
    case 'probe':
      return isNonEmptyString(v.url);
    case 'download':
      return (
        isNonEmptyString(v.url) &&
        isNonEmptyString(v.videoId) &&
        isString(v.title) &&
        isMode(v.mode) &&
        optional(v.height, isHeight) &&
        optional(v.audioFormat, isAudioFormat)
      );
    case 'cancel':
      return isNonEmptyString(v.jobId);
    case 'reveal':
      return isNonEmptyString(v.filePath);
    default:
      return false;
  }
}

/** Merges whatever is in storage with defaults, dropping invalid fields. */
export function normalizeSettings(v: unknown): Settings {
  const s = isRecord(v) ? v : {};
  return {
    outputDir: isString(s.outputDir) ? s.outputDir.trim() : DEFAULT_SETTINGS.outputDir,
    defaultMode: isMode(s.defaultMode) ? s.defaultMode : DEFAULT_SETTINGS.defaultMode,
    defaultHeight: isHeight(s.defaultHeight) ? s.defaultHeight : DEFAULT_SETTINGS.defaultHeight,
    audioFormat: isAudioFormat(s.audioFormat) ? s.audioFormat : DEFAULT_SETTINGS.audioFormat,
    maxConcurrent: isMaxConcurrent(s.maxConcurrent) ? s.maxConcurrent : DEFAULT_SETTINGS.maxConcurrent,
  };
}

export function isJob(v: unknown): v is Job {
  return (
    isRecord(v) &&
    isNonEmptyString(v.jobId) &&
    isString(v.videoId) &&
    isString(v.title) &&
    isMode(v.mode) &&
    isString(v.label) &&
    isFiniteNumber(v.percent) &&
    isFiniteNumber(v.startedAt) &&
    ['queued', 'running', 'done', 'failed', 'cancelled'].includes(v.status as string)
  );
}

export function isHistoryItem(v: unknown): v is HistoryItem {
  return (
    isRecord(v) &&
    isNonEmptyString(v.jobId) &&
    isString(v.title) &&
    isMode(v.mode) &&
    isString(v.label) &&
    isFiniteNumber(v.finishedAt) &&
    ['done', 'failed', 'cancelled'].includes(v.status as string)
  );
}

/** Absolute Windows (C:\..., \\server\share) or POSIX path, no NUL bytes. */
export function isAbsolutePathLike(p: string): boolean {
  if (p.includes('\0')) return false;
  return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\[^\\]+\\[^\\]+/.test(p) || p.startsWith('/');
}
