import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findInWingetPackages } from './which.js';

let root: string;

const touch = (...parts: string[]) => {
  const file = join(root, ...parts);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '');
  return file;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ytdl-winget-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('findInWingetPackages', () => {
  it('finds an exe at the package root (yt-dlp, deno)', () => {
    const exe = touch('yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe', 'yt-dlp.exe');
    expect(findInWingetPackages('yt-dlp', root)).toBe(exe);
  });

  it('finds an exe in a versioned bin folder (ffmpeg)', () => {
    const exe = touch('yt-dlp.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ffmpeg-N-1-win64-gpl', 'bin', 'ffmpeg.exe');
    expect(findInWingetPackages('ffmpeg', root)).toBe(exe);
  });

  it('returns null when absent or when the folder does not exist', () => {
    touch('Some.Package', 'other.exe');
    expect(findInWingetPackages('ffmpeg', root)).toBeNull();
    expect(findInWingetPackages('ffmpeg', join(root, 'missing'))).toBeNull();
  });
});
