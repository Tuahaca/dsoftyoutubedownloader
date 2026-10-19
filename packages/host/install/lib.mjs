// Shared helpers for install.mjs / uninstall.mjs (plain Node, no build step needed).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOST_NAME = 'com.tuaha.ytdl';
export const REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..', '..');
export const hostDist = resolve(here, '..', 'dist');
export const extensionManifest = join(repoRoot, 'packages', 'extension', 'public', 'manifest.json');

/** Chrome derives the extension ID from the manifest `key`: sha256(DER public key), first 32 hex chars mapped 0-f → a-p. */
export function extensionIdFromKey(base64Key) {
  const hex = createHash('sha256').update(Buffer.from(base64Key, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

export function readExtensionId() {
  const manifest = JSON.parse(readFileSync(extensionManifest, 'utf8'));
  if (typeof manifest.key !== 'string') throw new Error(`No "key" in ${extensionManifest}`);
  return extensionIdFromKey(manifest.key);
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

/** Same search as host/src/which.ts: winget package folders are on PATH only for newer processes. */
function findInWingetPackages(name) {
  const root = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Packages');
  const file = `${name}.exe`;
  for (const pkg of listDirs(root)) {
    if (isFile(join(pkg, file))) return join(pkg, file);
    for (const sub of listDirs(pkg)) {
      for (const candidate of [join(sub, file), join(sub, 'bin', file)]) {
        if (isFile(candidate)) return candidate;
      }
    }
  }
  return null;
}

export function which(name) {
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean);
  if (process.platform === 'win32') {
    dirs.push(join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links'));
  }
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase());
      if (isFile(candidate)) return candidate;
    }
  }
  return process.platform === 'win32' ? findInWingetPackages(name) : null;
}

/** Reads a previously written host-config.json so a re-run never replaces a working path with null. */
export function readPreviousConfig(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function stillExists(p) {
  return typeof p === 'string' && isFile(p) ? p : null;
}

export { existsSync };
