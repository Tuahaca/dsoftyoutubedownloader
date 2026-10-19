import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildDownloadArgs,
  buildProbeArgs,
  FORMAT_PREFIX,
  mapError,
  parseProgressLine,
  PROGRESS_PREFIX,
  ProgressTracker,
  trimInfo,
} from './ytdlp.js';

const URL_ = 'https://www.youtube.com/watch?v=abcdefghijk';
const fixture: unknown = JSON.parse(readFileSync(new URL('./__fixtures__/probe.json', import.meta.url), 'utf8'));

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('buildProbeArgs', () => {
  it('ignores user config, skips download and ends with -- URL', () => {
    const args = buildProbeArgs(URL_);
    expect(args).toContain('--ignore-config');
    expect(args).toContain('--dump-single-json');
    expect(args).toContain('--no-playlist');
    expect(args.slice(-2)).toEqual(['--', URL_]);
  });
});

describe('buildDownloadArgs', () => {
  it('video: sorts by resolution and prefers H.264/AAC in MP4', () => {
    const args = buildDownloadArgs({ canonicalUrl: URL_, mode: 'video', height: 720, outputDir: 'C:\\out', ffmpegPath: 'C:\\ff\\ffmpeg.exe' });
    expect(after(args, '--format-sort')).toBe('res:720,vcodec:h264,acodec:aac,ext:mp4:m4a');
    expect(after(args, '--format')).toBe('bv*+ba/b');
    expect(after(args, '--merge-output-format')).toBe('mp4');
    expect(after(args, '--paths')).toBe('C:\\out');
    expect(after(args, '--ffmpeg-location')).toBe('C:\\ff\\ffmpeg.exe');
    expect(args).toContain('--restrict-filenames');
    expect(args).toContain('--ignore-config');
    expect(args.slice(-2)).toEqual(['--', URL_]);
  });

  it('mp3: extracts best audio at top VBR quality', () => {
    const args = buildDownloadArgs({ canonicalUrl: URL_, mode: 'audio', audioFormat: 'mp3', outputDir: '/out' });
    expect(after(args, '--format')).toBe('ba');
    expect(after(args, '--audio-format')).toBe('mp3');
    expect(after(args, '--audio-quality')).toBe('0');
    expect(args).not.toContain('--merge-output-format');
    expect(args).not.toContain('--ffmpeg-location');
  });

  it('m4a: prefers native m4a to avoid re-encoding', () => {
    const args = buildDownloadArgs({ canonicalUrl: URL_, mode: 'audio', audioFormat: 'm4a', outputDir: '/out' });
    expect(after(args, '--format')).toBe('ba[ext=m4a]/ba');
    expect(after(args, '--audio-format')).toBe('m4a');
  });

  it('points yt-dlp at deno only when its path is known', () => {
    const withDeno = buildDownloadArgs({ canonicalUrl: URL_, mode: 'video', outputDir: '/out', denoPath: 'C:\\deno\\deno.exe' });
    expect(after(withDeno, '--js-runtimes')).toBe('deno:C:\\deno\\deno.exe');
    expect(buildDownloadArgs({ canonicalUrl: URL_, mode: 'video', outputDir: '/out' })).not.toContain('--js-runtimes');
    expect(after(buildProbeArgs(URL_, '/usr/bin/deno'), '--js-runtimes')).toBe('deno:/usr/bin/deno');
    expect(buildProbeArgs(URL_, '/usr/bin/deno').slice(-2)).toEqual(['--', URL_]);
  });

  it('output template never contains a directory component', () => {
    const tpl = after(buildDownloadArgs({ canonicalUrl: URL_, mode: 'video', outputDir: '/out' }), '--output') ?? '';
    expect(tpl).not.toMatch(/[\\/]/);
    expect(tpl).toContain('[%(id)s]');
  });
});

describe('parseProgressLine', () => {
  it('parses our progress template', () => {
    expect(parseProgressLine(`${PROGRESS_PREFIX}downloading|5242880|10485760|NA|1048576.5|5`)).toEqual({
      status: 'downloading',
      downloaded: 5242880,
      total: 10485760,
      speed: 1048576.5,
      eta: 5,
    });
  });

  it('falls back to the total estimate and tolerates NA', () => {
    expect(parseProgressLine(`${PROGRESS_PREFIX}downloading|100|NA|400|NA|NA`)).toEqual({
      status: 'downloading',
      downloaded: 100,
      total: 400,
      speed: null,
      eta: null,
    });
  });

  it('ignores other lines', () => {
    expect(parseProgressLine('[download] 5.0% of 10MiB')).toBeNull();
  });
});

describe('ProgressTracker', () => {
  const line = (status: string, done: number, total: number) =>
    parseProgressLine(`${PROGRESS_PREFIX}${status}|${done}|${total}|NA|100|1`)!;

  it('combines video+audio streams into one rising percentage, then reports merging', () => {
    const t = new ProgressTracker('video');
    t.onFormatLine(`${FORMAT_PREFIX}137+140`);
    expect(t.onProgress(line('downloading', 50, 100)).percent).toBe(25);
    expect(t.onProgress(line('finished', 100, 100)).percent).toBe(50);
    expect(t.onProgress(line('downloading', 0, 10)).percent).toBe(50);
    expect(t.onProgress(line('downloading', 5, 10)).percent).toBe(75);
    const merging = t.onProgress(line('finished', 10, 10));
    expect(merging.stage).toBe('merging');
    expect(merging.percent).toBe(99);
  });

  it('never goes backwards', () => {
    const t = new ProgressTracker('audio');
    t.onProgress(line('downloading', 80, 100));
    expect(t.onProgress(line('downloading', 10, 100)).percent).toBe(80);
  });

  it('single-stream audio reports converting after the download', () => {
    const t = new ProgressTracker('audio');
    t.onFormatLine(`${FORMAT_PREFIX}251`);
    expect(t.onProgress(line('finished', 1, 1)).stage).toBe('converting');
  });
});

describe('mapError', () => {
  it.each([
    ['ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access', 'PRIVATE'],
    ['ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.', 'AGE_RESTRICTED'],
    ['ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies', 'BOT_CHECK'],
    ['ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader', 'UNAVAILABLE'],
    ['ERROR: [youtube] abc: Join this channel to get access to members-only content', 'UNAVAILABLE'],
    ['ERROR: [youtube] abc: The uploader has not made this video available in your country', 'GEO_BLOCKED'],
    ['ERROR: [youtube] abc: Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>', 'NETWORK'],
    ['ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path', 'DEPENDENCY_MISSING'],
    ['ERROR: something new and strange', 'UNKNOWN'],
  ])('%s → %s', (stderr, code) => {
    expect(mapError(stderr).code).toBe(code);
  });

  it('uses the last ERROR line as the message', () => {
    expect(mapError('WARNING: x\nERROR: first\nERROR: second\n').message).toBe('second');
  });
});

describe('trimInfo', () => {
  it('keeps only what the popup needs', () => {
    const info = trimInfo(fixture);
    expect(info).toEqual({
      videoId: 'abcdefghijk',
      title: 'Sample Creative Commons Clip',
      channel: 'Sample Channel',
      durationSec: 634,
      thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg',
      heights: [2160, 1080, 720, 360, 144],
      isLive: false,
    });
    expect(JSON.stringify(info)).not.toContain('description');
  });

  it('labels vertical videos by their shorter side', () => {
    const info = trimInfo({ id: 'x', formats: [{ vcodec: 'avc1', width: 1080, height: 1920 }] });
    expect(info.heights).toEqual([1080]);
  });

  it('flags live streams and drops non-https thumbnails', () => {
    const info = trimInfo({ id: 'x', live_status: 'is_live', thumbnail: 'http://x/y.jpg' });
    expect(info.isLive).toBe(true);
    expect(info.thumbnailUrl).toBeNull();
  });
});
