/**
 * Single source of truth for every message shape in the project:
 *  - HostRequest / HostResponse: extension service worker <-> native host (Native Messaging)
 *  - UiRequest / UiResponse:     popup & options page <-> service worker (chrome.runtime messages)
 *  - Settings / Job / HistoryItem: what lives in chrome.storage
 */

export type Mode = 'video' | 'audio';
export type AudioFormat = 'mp3' | 'm4a';
export type MaxConcurrent = 1 | 2 | 3;

export type ErrorCode =
  | 'INVALID_URL'
  | 'INVALID_REQUEST'
  | 'UNAVAILABLE'
  | 'AGE_RESTRICTED'
  | 'PRIVATE'
  | 'GEO_BLOCKED'
  | 'BOT_CHECK'
  | 'LIVE_NOT_SUPPORTED'
  | 'NETWORK'
  | 'DEPENDENCY_MISSING'
  | 'CANCELLED'
  | 'HOST_MISSING'
  | 'HOST_FORBIDDEN'
  | 'HOST_DISCONNECTED'
  | 'UNKNOWN';

// ---------- extension -> host ----------

export interface HelloRequest {
  id: string;
  type: 'hello';
}

export interface ProbeRequest {
  id: string;
  type: 'probe';
  url: string;
}

export interface DownloadRequest {
  /** Also used as the job id for every progress/done/error message of this download. */
  id: string;
  type: 'download';
  url: string;
  mode: Mode;
  /** Video only: maximum resolution (shorter side, e.g. 1080). */
  height?: number;
  /** Audio only. */
  audioFormat?: AudioFormat;
  /** Absolute folder; the host's default (~/Downloads/YouTube) is used when omitted. */
  outputDir?: string;
  maxConcurrent?: MaxConcurrent;
}

export interface CancelRequest {
  id: string;
  type: 'cancel';
  jobId: string;
}

export interface RevealRequest {
  id: string;
  type: 'reveal';
  filePath: string;
}

export type HostRequest = HelloRequest | ProbeRequest | DownloadRequest | CancelRequest | RevealRequest;

// ---------- host -> extension ----------

export interface HelloResponse {
  id: string;
  type: 'hello';
  hostVersion: string;
  /** null when yt-dlp could not be found or run. */
  ytDlpVersion: string | null;
  ffmpeg: boolean;
  defaultOutputDir: string;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number | null;
  thumbnailUrl: string | null;
  /** Available resolutions (shorter side), sorted high → low. */
  heights: number[];
}

export interface InfoResponse extends VideoInfo {
  id: string;
  type: 'info';
}

export type ProgressStage = 'downloading' | 'merging' | 'converting';

export interface ProgressResponse {
  id: string;
  type: 'progress';
  percent: number;
  /** Bytes per second. */
  speed?: number;
  etaSec?: number;
  stage: ProgressStage;
}

export interface DoneResponse {
  id: string;
  type: 'done';
  filePath: string;
}

export interface CancelledResponse {
  id: string;
  type: 'cancelled';
}

export interface RevealedResponse {
  id: string;
  type: 'revealed';
}

export interface ErrorResponse {
  /** Empty string when the failing message had no usable id. */
  id: string;
  type: 'error';
  code: ErrorCode;
  message: string;
}

export type HostResponse =
  | HelloResponse
  | InfoResponse
  | ProgressResponse
  | DoneResponse
  | CancelledResponse
  | RevealedResponse
  | ErrorResponse;

// ---------- storage ----------

export interface Settings {
  /** Empty string = use the host's default folder. */
  outputDir: string;
  defaultMode: Mode;
  defaultHeight: number;
  audioFormat: AudioFormat;
  maxConcurrent: MaxConcurrent;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  jobId: string;
  videoId: string;
  title: string;
  mode: Mode;
  /** "1080p", "MP3", ... for display. */
  label: string;
  status: JobStatus;
  percent: number;
  stage?: ProgressStage;
  speed?: number;
  etaSec?: number;
  filePath?: string;
  error?: { code: ErrorCode; message: string };
  startedAt: number;
}

export interface HistoryItem {
  jobId: string;
  videoId: string;
  title: string;
  mode: Mode;
  label: string;
  status: 'done' | 'failed' | 'cancelled';
  filePath?: string;
  error?: string;
  finishedAt: number;
}

// ---------- popup/options -> service worker ----------

export type UiRequest =
  | { kind: 'hello' }
  | { kind: 'probe'; url: string }
  | {
      kind: 'download';
      url: string;
      videoId: string;
      title: string;
      mode: Mode;
      height?: number;
      audioFormat?: AudioFormat;
    }
  | { kind: 'cancel'; jobId: string }
  | { kind: 'reveal'; filePath: string }
  | { kind: 'popupOpened' };

export interface UiError {
  code: ErrorCode;
  message: string;
}

export type UiResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: UiError };
