// End-to-end check of the built host against real yt-dlp. Needs network, yt-dlp + ffmpeg, and
// YTDL_TEST_URL pointing at a short Creative Commons video. Run: npm run test:integration
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HostResponse } from '@ytdl/shared';
import { encodeMessage, MessageDecoder } from '../src/stdio.js';

const TEST_URL = process.env.YTDL_TEST_URL;
const HOST = fileURLToPath(new URL('../dist/host.cjs', import.meta.url));

describe.skipIf(!TEST_URL)('native host (integration)', () => {
  let host: ChildProcessWithoutNullStreams;
  const received: HostResponse[] = [];
  const outDir = mkdtempSync(join(tmpdir(), 'ytdl-int-'));

  const waitFor = (pred: (m: HostResponse) => boolean, timeoutMs = 170_000) =>
    new Promise<HostResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      const check = () => {
        const hit = received.find(pred);
        if (hit) {
          clearTimeout(timer);
          resolve(hit);
        } else setTimeout(check, 100);
      };
      check();
    });

  beforeAll(() => {
    host = spawn(process.execPath, [HOST], { stdio: 'pipe' });
    const decoder = new MessageDecoder(
      (m) => received.push(m as HostResponse),
      (e) => {
        throw new Error(`decode error: ${e.kind}`);
      },
      2 * 1024 * 1024,
    );
    host.stdout.on('data', (c: Buffer) => decoder.push(c));
  });

  afterAll(() => {
    host.stdin.end();
    rmSync(outDir, { recursive: true, force: true });
  });

  it('answers hello with versions', async () => {
    host.stdin.write(encodeMessage({ id: 'h', type: 'hello' }));
    const hello = await waitFor((m) => m.id === 'h');
    expect(hello).toMatchObject({ type: 'hello', ffmpeg: true });
    expect(hello.type === 'hello' && hello.ytDlpVersion).toBeTruthy();
  });

  it('probes video info', async () => {
    host.stdin.write(encodeMessage({ id: 'p', type: 'probe', url: TEST_URL }));
    const info = await waitFor((m) => m.id === 'p');
    expect(info.type).toBe('info');
    if (info.type === 'info') expect(info.heights.length).toBeGreaterThan(0);
  });

  it('downloads 360p MP4', async () => {
    host.stdin.write(encodeMessage({ id: 'd', type: 'download', url: TEST_URL, mode: 'video', height: 360, outputDir: outDir }));
    const done = await waitFor((m) => m.id === 'd' && (m.type === 'done' || m.type === 'error'));
    expect(done.type).toBe('done');
    if (done.type === 'done') {
      expect(done.filePath.endsWith('.mp4')).toBe(true);
      expect(existsSync(done.filePath)).toBe(true);
    }
  });
});
