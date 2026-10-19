// Shared helpers for install.mjs / uninstall.mjs (plain Node, no build step needed).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
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
  return null;
}

export { existsSync };
