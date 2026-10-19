const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

export function isValidVideoId(id: string): boolean {
  return VIDEO_ID_RE.test(id);
}

/**
 * Extracts the video ID from a YouTube video URL, or returns null for anything else.
 * Accepts /watch?v=, /shorts/, /embed/, /live/ and youtu.be/ links over http(s) only.
 */
export function parseYouTubeVideoId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.port) return null;

  const host = url.hostname.toLowerCase();
  let candidate: string | null = null;

  if (host === 'youtu.be') {
    candidate = url.pathname.split('/')[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch' && parts.length === 1) {
      candidate = url.searchParams.get('v');
    } else if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts.length === 2) {
      candidate = parts[1] ?? null;
    }
  }

  return candidate !== null && isValidVideoId(candidate) ? candidate : null;
}

/** The only URL form ever handed to yt-dlp: rebuilt from a validated ID, never the raw input. */
export function canonicalWatchUrl(videoId: string): string {
  if (!isValidVideoId(videoId)) throw new Error(`Invalid video id: ${videoId}`);
  return `https://www.youtube.com/watch?v=${videoId}`;
}
