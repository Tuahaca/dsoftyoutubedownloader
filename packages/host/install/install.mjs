// Registers the Native Messaging host for Chrome (current user, no admin rights needed).
// Run via `npm run host:install`, which builds packages/host/dist/host.cjs first.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  existsSync,
  HOST_NAME,
  hostDist,
  readExtensionId,
  readPreviousConfig,
  REG_KEY,
  stillExists,
  which,
} from './lib.mjs';

if (process.platform !== 'win32') {
  console.error('Only Windows is supported by this installer for now (macOS/Linux are planned for v1.1).');
  process.exit(1);
}

const hostScript = join(hostDist, 'host.cjs');
if (!existsSync(hostScript)) {
  console.error(`Missing ${hostScript}. Run "npm run build -w @ytdl/host" first.`);
  process.exit(1);
}

const extensionId = readExtensionId();
const configPath = join(hostDist, 'host-config.json');
const previous = readPreviousConfig(configPath);
// Fresh lookup first; fall back to the last recorded path if it still exists (e.g. a re-run
// from an old terminal whose PATH predates the winget install).
const ytDlpPath = which('yt-dlp') ?? stillExists(previous.ytDlpPath);
const ffmpegPath = which('ffmpeg') ?? stillExists(previous.ffmpegPath);
const denoPath = which('deno') ?? stillExists(previous.denoPath);

// Absolute node path: Chrome's PATH may not include Node.
const batPath = join(hostDist, 'host.bat');
writeFileSync(batPath, `@echo off\r\n"${process.execPath}" "%~dp0host.cjs" %*\r\n`);

writeFileSync(configPath, JSON.stringify({ ytDlpPath, ffmpegPath, denoPath }, null, 2) + '\n');

const manifestPath = join(hostDist, `${HOST_NAME}.json`);
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      name: HOST_NAME,
      description: 'YouTube Downloader helper (runs yt-dlp/ffmpeg locally)',
      path: batPath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
    null,
    2,
  ) + '\n',
);

const reg = spawnSync('reg', ['add', REG_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'], {
  shell: false,
  encoding: 'utf8',
});
if (reg.status !== 0) {
  console.error('Failed to write the registry key:', reg.stderr || reg.stdout);
  process.exit(1);
}

console.log(`✔ Native host registered: ${REG_KEY}`);
console.log(`  manifest:     ${manifestPath}`);
console.log(`  extension id: ${extensionId}`);
console.log(`  node:         ${process.execPath}`);
console.log(`  yt-dlp:       ${ytDlpPath ?? 'NOT FOUND'}`);
console.log(`  ffmpeg:       ${ffmpegPath ?? 'NOT FOUND'}`);
console.log(`  deno:         ${denoPath ?? 'NOT FOUND'}`);

// The winget yt-dlp package also installs ffmpeg and Deno as dependencies.
const missing = [];
if (!ytDlpPath) missing.push('winget install yt-dlp.yt-dlp');
if (!ffmpegPath) missing.push('winget install Gyan.FFmpeg');
if (!denoPath) missing.push('winget install DenoLand.Deno');
if (missing.length) {
  console.log('\n⚠ Missing dependencies. Install them, open a NEW terminal, and run "npm run host:install" again:');
  for (const cmd of missing) console.log(`    ${cmd}`);
}
console.log('\nFully restart Chrome so it picks up the helper: open chrome://restart in the address bar.');
console.log('(Closing the windows is not enough. Chrome keeps running in the system tray.)');
