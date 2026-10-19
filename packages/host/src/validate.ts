import { isAbsolute, normalize, relative, resolve } from 'node:path';
import {
  canonicalWatchUrl,
  isAbsolutePathLike,
  isHostRequest,
  parseYouTubeVideoId,
  type ErrorCode,
  type HostRequest,
} from '@ytdl/shared';

export type Validated<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };

/** Shape check + YouTube allow-list. The URL is replaced by a canonical one rebuilt from the ID. */
export function validateRequest(raw: unknown): Validated<HostRequest & { videoId?: string }> {
  if (!isHostRequest(raw)) {
    return { ok: false, code: 'INVALID_REQUEST', message: 'Malformed request' };
  }
  if (raw.type === 'probe' || raw.type === 'download') {
    const videoId = parseYouTubeVideoId(raw.url);
    if (!videoId) return { ok: false, code: 'INVALID_URL', message: 'Not a YouTube video URL' };
    if (raw.type === 'download' && raw.outputDir !== undefined && raw.outputDir !== '') {
      if (!isAbsolutePathLike(raw.outputDir) || !isAbsolute(raw.outputDir)) {
        return { ok: false, code: 'INVALID_REQUEST', message: 'Output folder must be an absolute path' };
      }
    }
    return { ok: true, value: { ...raw, url: canonicalWatchUrl(videoId), videoId } };
  }
  if (raw.type === 'reveal' && (!isAbsolutePathLike(raw.filePath) || !isAbsolute(raw.filePath))) {
    return { ok: false, code: 'INVALID_REQUEST', message: 'File path must be absolute' };
  }
  return { ok: true, value: raw };
}

/** True when `child` resolves to `dir` itself or somewhere inside it. */
export function isInsideDir(dir: string, child: string): boolean {
  const caseFold = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = relative(caseFold(resolve(normalize(dir))), caseFold(resolve(normalize(child))));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
