import { describe, expect, it } from 'vitest';
import { formatDuration, formatEta, formatSpeed, qualityLabel } from './format.js';

describe('format helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(605)).toBe('10:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('formats speeds', () => {
    expect(formatSpeed(undefined)).toBe('');
    expect(formatSpeed(512)).toBe('512 B/s');
    expect(formatSpeed(1536)).toBe('1.5 KB/s');
    expect(formatSpeed(5 * 1024 * 1024)).toBe('5.0 MB/s');
  });

  it('formats ETA', () => {
    expect(formatEta(65)).toBe('1:05 left');
    expect(formatEta(undefined)).toBe('');
  });

  it('builds quality labels', () => {
    expect(qualityLabel('video', 1080)).toBe('1080p');
    expect(qualityLabel('video')).toBe('Best');
    expect(qualityLabel('audio', undefined, 'm4a')).toBe('M4A');
    expect(qualityLabel('audio')).toBe('MP3');
  });
});
