import type { Settings } from './protocol.js';

/** Native Messaging host name; must match the host manifest and the registry key. */
export const HOST_NAME = 'com.tuaha.ytdl';

/** Chrome caps host → extension messages at 1 MB. */
export const MAX_HOST_MESSAGE_BYTES = 1024 * 1024;

/** We never expect large requests from the extension; reject anything bigger. */
export const MAX_EXTENSION_MESSAGE_BYTES = 64 * 1024;

export const MAX_HISTORY_ITEMS = 20;

export const PROGRESS_MIN_INTERVAL_MS = 250;

export const PROBE_CACHE_TTL_MS = 10 * 60 * 1000;

export const MIN_HEIGHT = 144;
export const MAX_HEIGHT = 4320;

/** Quality choices offered in the options page for the default height. */
export const QUALITY_PRESETS = [2160, 1440, 1080, 720, 480, 360] as const;

export const AUDIO_FORMATS = ['mp3', 'm4a'] as const;

export const DEFAULT_SETTINGS: Settings = {
  outputDir: '',
  defaultMode: 'video',
  defaultHeight: 1080,
  audioFormat: 'mp3',
  maxConcurrent: 2,
};

export const README_URL =
  'https://github.com/Tuahaca/dsoftyoutubedownloader#installation-windows';
