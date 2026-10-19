import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name));
  } catch {
    return [];
  }
}

export function wingetPackagesDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Packages');
}

/**
 * Looks for `<name>.exe` inside winget's per-package folders (`<pkg>/x.exe`, `<pkg>/*\/x.exe`,
 * `<pkg>/*\/bin/x.exe`). These folders are only added to PATH for processes started after the
 * install, so a long-running Chrome (and the host it launches) never sees them on PATH.
 */
export function findInWingetPackages(name: string, packagesDir: string): string | null {
  const file = `${name}.exe`;
  for (const pkg of listDirs(packagesDir)) {
    const direct = join(pkg, file);
    if (isFile(direct)) return direct;
    for (const sub of listDirs(pkg)) {
      for (const candidate of [join(sub, file), join(sub, 'bin', file)]) {
        if (isFile(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * Finds an executable on PATH, then (Windows) in winget's Links and Packages folders, which
 * Chrome's inherited PATH often lacks right after installing.
 */
export function which(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  if (process.platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    dirs.push(join(local, 'Microsoft', 'WinGet', 'Links'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
  }
  const exts =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean).map((e) => e.toLowerCase())
      : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (isFile(candidate)) return candidate;
    }
  }
  return process.platform === 'win32' ? findInWingetPackages(name, wingetPackagesDir(env)) : null;
}

export function existingFile(p: string | undefined | null): string | null {
  return p && existsSync(p) && isFile(p) ? p : null;
}
