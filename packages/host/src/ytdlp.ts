import { isRecord, type AudioFormat, type ErrorCode, type Mode, type ProgressStage, type VideoInfo } from '@ytdl/shared';

/** Prefixes we put on lines we ask yt-dlp to print, so we can tell them apart from anything else. */
export const PROGRESS_PREFIX = 'YTDL_PROGRESS ';
export const FORMAT_PREFIX = 'YTDL_FORMAT ';
export const FILE_PREFIX = 'YTDL_FILE ';

/** Flags used for every invocation: predictable output, no user config, never playlists. */
const COMMON_ARGS = ['--ignore-config', '--no-playlist', '--no-colors', '--no-warnings'];

/** Points yt-dlp at our Deno, since Chrome may launch the host with a stale PATH. */
function jsRuntimeArgs(denoPath: string | null | undefined): string[] {
  return denoPath ? ['--js-runtimes', `deno:${denoPath}`] : [];
}

export function buildProbeArgs(canonicalUrl: string, denoPath?: string | null): string[] {
  return [...COMMON_ARGS, ...jsRuntimeArgs(denoPath), '--dump-single-json', '--skip-download', '--', canonicalUrl];
}

export interface DownloadArgsInput {
  canonicalUrl: string;
  mode: Mode;
  height?: number;
  audioFormat?: AudioFormat;
  outputDir: string;
  ffmpegPath?: string | null;
  denoPath?: string | null;
}

/**
 * The only place yt-dlp download arguments are built. Always passed to spawn() as an array
 * (shell: false), and the URL always comes last after `--` so it can never be read as a flag.
 */
export function buildDownloadArgs(input: DownloadArgsInput): string[] {
  const args = [
    ...COMMON_ARGS,
    '--newline',
    '--progress',
    '--no-simulate',
    '--no-mtime',
    '--restrict-filenames',
    '--paths',
    input.outputDir,
    '--output',
    '%(title).150B [%(id)s].%(ext)s',
    '--progress-template',
    `download:${PROGRESS_PREFIX}%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
    '--print',
    `video:${FORMAT_PREFIX}%(format_id)s`,
    '--print',
    `after_move:${FILE_PREFIX}%(filepath)s`,
  ];

  if (input.ffmpegPath) args.push('--ffmpeg-location', input.ffmpegPath);
  args.push(...jsRuntimeArgs(input.denoPath));

  if (input.mode === 'video') {
    const sort = input.height ? `res:${input.height},vcodec:h264,acodec:aac,ext:mp4:m4a` : 'vcodec:h264,acodec:aac,ext:mp4:m4a';
    args.push('--format-sort', sort, '--format', 'bv*+ba/b', '--merge-output-format', 'mp4');
  } else if ((input.audioFormat ?? 'mp3') === 'm4a') {
    args.push('--format', 'ba[ext=m4a]/ba', '--extract-audio', '--audio-format', 'm4a');
  } else {
    args.push('--format', 'ba', '--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  }

  args.push('--', input.canonicalUrl);
  return args;
}

export interface RawProgress {
  status: string;
  downloaded: number | null;
  total: number | null;
  speed: number | null;
  eta: number | null;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s === 'NA' || s === 'None' || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function parseProgressLine(line: string): RawProgress | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  const [status, downloaded, total, estimate, speed, eta] = line.slice(PROGRESS_PREFIX.length).trim().split('|');
  if (!status) return null;
  return {
    status,
    downloaded: num(downloaded),
    total: num(total) ?? num(estimate),
    speed: num(speed),
    eta: num(eta),
  };
}

export interface ProgressUpdate {
  percent: number;
  speed?: number;
  etaSec?: number;
  stage: ProgressStage;
}

/**
 * Turns per-stream yt-dlp progress (video stream 0→100, then audio stream 0→100) into one
 * overall, never-decreasing percentage. The stream count comes from the printed format_id
 * ("137+140" = 2 streams).
 */
export class ProgressTracker {
  private streams = 1;
  private finished = 0;
  private last = 0;

  constructor(private readonly mode: Mode) {}

  onFormatLine(line: string): void {
    if (!line.startsWith(FORMAT_PREFIX)) return;
    const formatId = line.slice(FORMAT_PREFIX.length).trim();
    this.streams = Math.max(1, formatId.split('+').length);
  }

  onProgress(p: RawProgress): ProgressUpdate {
    if (p.status === 'finished') {
      this.finished = Math.min(this.streams, this.finished + 1);
      if (this.finished >= this.streams) {
        this.last = Math.max(this.last, 99);
        return { percent: this.last, stage: this.mode === 'video' ? 'merging' : 'converting' };
      }
      return this.emit(this.finished / this.streams);
    }
    const streamFraction = p.total && p.downloaded !== null ? Math.min(1, p.downloaded / p.total) : 0;
    const update = this.emit((this.finished + streamFraction) / this.streams);
    if (p.speed !== null) update.speed = p.speed;
    if (p.eta !== null) update.etaSec = p.eta;
    return update;
  }

  private emit(fraction: number): ProgressUpdate {
    // Keep 99–100 for post-processing so "merging" never shows a lower number than "downloading".
    const pct = Math.min(98.9, Math.round(fraction * 1000) / 10);
    this.last = Math.max(this.last, pct);
    return { percent: this.last, stage: 'downloading' };
  }
}

/** Maps yt-dlp stderr to an error code. Order matters: most specific first. */
export function mapError(stderr: string): { code: ErrorCode; message: string } {
  const errorLines = stderr
    .split(/\r?\n/)
    .filter((l) => l.startsWith('ERROR:'))
    .map((l) => l.replace(/^ERROR:\s*/, '').trim());
  const message = (errorLines.at(-1) ?? stderr.trim().split(/\r?\n/).at(-1) ?? 'yt-dlp failed').slice(0, 500);
  const text = stderr.toLowerCase();

  const rules: [ErrorCode, RegExp][] = [
    ['BOT_CHECK', /confirm you.?re not a bot/],
    ['AGE_RESTRICTED', /confirm your age|age[- ]restricted|inappropriate for some users/],
    ['PRIVATE', /private video|video is private/],
    ['GEO_BLOCKED', /available in your country|geo.?restrict|blocked it in your country/],
    ['LIVE_NOT_SUPPORTED', /is a live stream|live event will begin|premieres in/],
    ['UNAVAILABLE', /video unavailable|is unavailable|has been removed|members.?only|join this channel|no longer available|account associated with this video has been terminated/],
    ['DEPENDENCY_MISSING', /ffmpeg (is )?not (found|installed)|ffprobe and ffmpeg not found|ffmpeg-location/],
    ['INVALID_URL', /is not a valid url|unsupported url/],
    ['NETWORK', /unable to download (webpage|api page)|getaddrinfo|timed out|connection (reset|refused|aborted)|network is unreachable|http error 5\d\d|temporary failure in name resolution|ssl/],
  ];
  for (const [code, re] of rules) {
    if (re.test(text)) return { code, message };
  }
  return { code: 'UNKNOWN', message };
}

/**
 * Trims `yt-dlp -J` output (often several MB) down to what the popup needs. Never forward
 * the raw JSON: it can blow the 1 MB Native Messaging limit.
 */
export function trimInfo(json: unknown): VideoInfo & { isLive: boolean } {
  if (!isRecord(json)) throw new Error('yt-dlp returned non-object JSON');
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

  const heights = new Set<number>();
  if (Array.isArray(json.formats)) {
    for (const f of json.formats) {
      if (!isRecord(f) || f.vcodec === 'none') continue;
      const h = typeof f.height === 'number' ? f.height : null;
      const w = typeof f.width === 'number' ? f.width : null;
      if (h === null) continue;
      // Label by the shorter side so a vertical 1080x1920 Short shows as 1080p.
      const shortSide = w !== null ? Math.min(w, h) : h;
      if (shortSide >= 144) heights.add(shortSide);
    }
  }

  const thumb = str(json.thumbnail);
  const liveStatus = str(json.live_status);
  return {
    videoId: str(json.id),
    title: str(json.title, 'Untitled'),
    channel: str(json.channel) || str(json.uploader),
    durationSec: typeof json.duration === 'number' ? json.duration : null,
    thumbnailUrl: thumb.startsWith('https://') ? thumb : null,
    heights: [...heights].sort((a, b) => b - a),
    isLive: json.is_live === true || liveStatus === 'is_live' || liveStatus === 'is_upcoming',
  };
}
