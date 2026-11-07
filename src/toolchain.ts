import { spawn } from 'child_process';
import * as fs from 'fs';
import { baseTempDir } from './tempDir';
import * as path from 'path';

/**
 * Compiler auto-detection for C / C++.
 * Scans `cl` (MSVC), `gcc`/`g++`, `clang`/`clang++` and verifies each candidate by
 * actually compiling a tiny program. Results are cached for the session.
 */

interface ProbeResult {
  found: boolean;
  detail?: string;
}

function run(command: string, args: string[], cwd: string): Promise<{ code: number | null; spawnError?: string; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    let child;
    try {
      child = spawn(command, args, { cwd, windowsHide: true });
    } catch (e: any) {
      resolve({ code: null, spawnError: e?.message ?? String(e), stderr: '' });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 15000);
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, spawnError: err?.message ?? String(err), stderr });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

async function probeCompiler(command: string, lang: 'c' | 'cpp', extraArgs: string[]): Promise<ProbeResult> {
  if (!command) return { found: false };
  const dir = await fs.promises.mkdtemp(path.join(baseTempDir(), 'nuaa-cc-'));
  const isWindows = process.platform === 'win32';
  const src = path.join(dir, lang === 'c' ? 'probe.c' : 'probe.cpp');
  await fs.promises.writeFile(src, lang === 'c' ? 'int main(void){return 0;}\n' : 'int main(){return 0;}\n');
  const out = path.join(dir, 'probe' + (isWindows ? '.exe' : ''));
  try {
    let args: string[];
    if (path.basename(command).toLowerCase() === 'cl' || command.toLowerCase() === 'cl') {
      args = ['/nologo', src, '/Fe:' + out];
    } else {
      args = [...extraArgs, src, '-o', out];
    }
    const r = await run(command, args, dir);
    if (r.spawnError) return { found: false, detail: r.spawnError };
    if (r.code === 0 && fs.existsSync(out)) return { found: true };
    return { found: false, detail: (r.stderr || '').slice(0, 200) };
  } catch (e: any) {
    return { found: false, detail: e?.message ?? String(e) };
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

let cacheC: string | undefined | null = null;
let cacheCpp: string | undefined | null = null;

export interface DetectedCompilers {
  c: string;
  cpp: string;
  cDetail: string;
  cppDetail: string;
}

const C_CANDIDATES: Array<[string, string[]]> = [
  ['cl', []],
  ['gcc', ['-O2']],
  ['clang', ['-O2']],
];
const CPP_CANDIDATES: Array<[string, string[]]> = [
  ['cl', []],
  ['g++', ['-O2']],
  ['clang++', ['-O2']],
];

async function detect(kind: 'c' | 'cpp'): Promise<string | undefined> {
  const candidates = kind === 'c' ? C_CANDIDATES : CPP_CANDIDATES;
  for (const [cmd, extra] of candidates) {
    const r = await probeCompiler(cmd, kind, extra);
    if (r.found) return cmd;
  }
  return undefined;
}

/** Returns the C compiler to use (configured value wins; otherwise auto-detected; else 'clang'). */
export async function resolveCCompiler(configured: string | undefined): Promise<{ command: string; source: string }> {
  if (configured && configured.trim()) return { command: configured.trim(), source: 'set' };
  if (cacheC === null) cacheC = await detect('c');
  if (cacheC) return { command: cacheC, source: 'detected' };
  return { command: 'clang', source: 'fallback' };
}

/** Returns the C++ compiler to use (configured value wins; otherwise auto-detected; else 'clang++'). */
export async function resolveCppCompiler(configured: string | undefined): Promise<{ command: string; source: string }> {
  if (configured && configured.trim()) return { command: configured.trim(), source: 'set' };
  if (cacheCpp === null) cacheCpp = await detect('cpp');
  if (cacheCpp) return { command: cacheCpp, source: 'detected' };
  return { command: 'clang++', source: 'fallback' };
}

