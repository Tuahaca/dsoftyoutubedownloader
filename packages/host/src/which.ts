import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds an executable on PATH (plus winget's Links folder on Windows, which Chrome's
 * inherited PATH often lacks right after installing).
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
  return null;
}

export function existingFile(p: string | undefined | null): string | null {
  return p && existsSync(p) && isFile(p) ? p : null;
}
