import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './constants.js';
import { isAbsolutePathLike, isHostRequest, isHostResponse, isUiRequest, normalizeSettings } from './guards.js';

describe('isHostRequest', () => {
  it('accepts well-formed requests', () => {
    expect(isHostRequest({ id: '1', type: 'hello' })).toBe(true);
    expect(isHostRequest({ id: '1', type: 'probe', url: 'https://youtu.be/x' })).toBe(true);
    expect(isHostRequest({ id: '1', type: 'download', url: 'u', mode: 'video', height: 1080 })).toBe(true);
    expect(isHostRequest({ id: '1', type: 'download', url: 'u', mode: 'audio', audioFormat: 'm4a', maxConcurrent: 3 })).toBe(true);
    expect(isHostRequest({ id: '1', type: 'cancel', jobId: 'j' })).toBe(true);
    expect(isHostRequest({ id: '1', type: 'reveal', filePath: 'C:\\a.mp4' })).toBe(true);
  });

  it('rejects malformed requests', () => {
    expect(isHostRequest(null)).toBe(false);
    expect(isHostRequest([])).toBe(false);
    expect(isHostRequest({ type: 'hello' })).toBe(false);
    expect(isHostRequest({ id: '', type: 'hello' })).toBe(false);
    expect(isHostRequest({ id: 'x'.repeat(65), type: 'hello' })).toBe(false);
    expect(isHostRequest({ id: '1', type: 'exec', cmd: 'calc' })).toBe(false);
    expect(isHostRequest({ id: '1', type: 'download', url: 'u', mode: 'flac' })).toBe(false);
    expect(isHostRequest({ id: '1', type: 'download', url: 'u', mode: 'video', height: 99999 })).toBe(false);
    expect(isHostRequest({ id: '1', type: 'download', url: 'u', mode: 'video', height: 720.5 })).toBe(false);
    expect(isHostRequest({ id: '1', type: 'download', url: 'u', mode: 'audio', audioFormat: 'wav' })).toBe(false);
    expect(isHostRequest({ id: '1', type: 'download', url: 'u', mode: 'video', maxConcurrent: 10 })).toBe(false);
    expect(isHostRequest({ id: '1', type: 'probe' })).toBe(false);
  });
});

describe('isHostResponse', () => {
  it('accepts each response type', () => {
    expect(isHostResponse({ id: '1', type: 'hello', hostVersion: '0.1.0', ytDlpVersion: null, ffmpeg: false, defaultOutputDir: 'C:\\x' })).toBe(true);
    expect(isHostResponse({ id: '1', type: 'info', videoId: 'v', title: 't', channel: 'c', durationSec: null, thumbnailUrl: null, heights: [1080] })).toBe(true);
    expect(isHostResponse({ id: '1', type: 'progress', percent: 5, stage: 'downloading' })).toBe(true);
    expect(isHostResponse({ id: '1', type: 'done', filePath: '/a.mp4' })).toBe(true);
    expect(isHostResponse({ id: '1', type: 'cancelled' })).toBe(true);
    expect(isHostResponse({ id: '', type: 'error', code: 'PRIVATE', message: 'x' })).toBe(true);
  });

  it('rejects unknown codes and bad shapes', () => {
    expect(isHostResponse({ id: '1', type: 'error', code: 'NOPE', message: 'x' })).toBe(false);
    expect(isHostResponse({ id: '1', type: 'progress', percent: '5', stage: 'downloading' })).toBe(false);
    expect(isHostResponse({ id: '1', type: 'info', videoId: 'v', title: 't', channel: 'c', durationSec: null, thumbnailUrl: null, heights: ['1080'] })).toBe(false);
    expect(isHostResponse({ type: 'done', filePath: '/a' })).toBe(false);
  });
});

describe('isUiRequest', () => {
  it('validates popup messages', () => {
    expect(isUiRequest({ kind: 'popupOpened' })).toBe(true);
    expect(isUiRequest({ kind: 'download', url: 'u', videoId: 'v', title: 't', mode: 'audio', audioFormat: 'mp3' })).toBe(true);
    expect(isUiRequest({ kind: 'download', url: 'u', videoId: 'v', title: 't', mode: 'gif' })).toBe(false);
    expect(isUiRequest({ kind: 'shell' })).toBe(false);
  });
});

describe('normalizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and drops invalid ones', () => {
    expect(
      normalizeSettings({ outputDir: '  D:\\Videos ', defaultMode: 'audio', defaultHeight: 7, audioFormat: 'm4a', maxConcurrent: 9 }),
    ).toEqual({ ...DEFAULT_SETTINGS, outputDir: 'D:\\Videos', defaultMode: 'audio', audioFormat: 'm4a' });
  });
});

describe('isAbsolutePathLike', () => {
  it.each(['C:\\Users\\me\\Videos', 'd:/media', '\\\\nas\\share\\yt', '/home/me/Videos'])('accepts %s', (p) => {
    expect(isAbsolutePathLike(p)).toBe(true);
  });
  it.each(['Videos', '.\\x', '..\\..\\Windows', 'C:relative', 'C:\\a\0b', ''])('rejects %s', (p) => {
    expect(isAbsolutePathLike(p)).toBe(false);
  });
});
