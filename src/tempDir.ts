import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let cached: string | undefined;

/**
 * Base temp directory.
 *
 * On Windows the default temp dir lives under the user profile, which often contains
 * non-ASCII characters (e.g. a Chinese user name). Some toolchains (gcc/gdb/clang)
 * can misbehave with such paths, so prefer the all-ASCII, always-present and
 * user-writable C:\Users\Public directory. Fall back to os.tmpdir() if unavailable.
 */
export function baseTempDir(): string {
  if (cached) return cached;
  if (process.platform === 'win32') {
    const candidates: string[] = [];
    if (process.env.PUBLIC) candidates.push(process.env.PUBLIC);
    candidates.push('C:\\Users\\Public');
    for (const pub of candidates) {
      const dir = path.join(pub, 'nuaa-oj-temp');
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.accessSync(dir, fs.constants.W_OK);
        cached = dir;
        return cached;
      } catch {
        /* try next */
      }
    }
  }
  cached = os.tmpdir();
  return cached;
}

export async function ensureBaseTempDir(): Promise<string> {
  const dir = baseTempDir();
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}