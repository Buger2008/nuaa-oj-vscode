import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Sample } from './samples';

export type CaseStatus = 'AC' | 'WA' | 'RE' | 'TLE' | 'CE' | 'OK';

export interface CaseResult {
  index: number;
  input: string;
  expected: string;
  actual: string;
  stderr: string;
  status: CaseStatus;
  timeMs: number;
}

export interface RunResult {
  ok: boolean;
  language: string;
  skipped?: string;
  compileError?: string;
  cases: CaseResult[];
  totalTimeMs: number;
  cloud?: boolean;
}

export interface RunnerConfig {
  c: string;
  cArgs: string;
  cpp: string;
  cppArgs: string;
  java: string;
  javaRun: string;
  python: string;
  javascript: string;
  go: string;
  rust: string;
  php: string;
  ruby: string;
  timeLimitExtraMs: number;
}

interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  timeMs: number;
  spawnError?: string;
}

function runProcess(
  command: string,
  args: string[],
  opts: { cwd: string; stdin?: string; timeoutMs: number },
): Promise<ProcResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let child;
    try {
      child = spawn(command, args, { cwd: opts.cwd, windowsHide: true });
    } catch (e: any) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, timeMs: 0, spawnError: e?.message ?? String(e) });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, Math.max(1000, opts.timeoutMs));

    child.stdout?.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 5_000_000) stdout = stdout.slice(0, 5_000_000);
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(0, 1_000_000);
    });
    child.on('error', (err: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, timedOut, timeMs: Date.now() - start, spawnError: err?.message ?? String(err) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, timeMs: Date.now() - start });
    });

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
}

function normalize(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}

function compare(expected: string, actual: string): boolean {
  if (normalize(expected) === normalize(actual)) return true;
  const tok = (s: string) => normalize(s).split(/\s+/).filter(Boolean);
  const a = tok(expected);
  const b = tok(actual);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Plan {
  compile?: { command: string; args: (src: string, outDir: string) => string[] };
  run: (src: string, outDir: string) => { command: string; args: string[] };
}

// libc++ (clang) does not ship GNU's <bits/stdc++.h>. Provide a shim so that
// code written with `#include <bits/stdc++.h>` still compiles locally under clang.
let shimPromise: Promise<string | undefined> | undefined;
function ensureBitsShim(): Promise<string | undefined> {
  if (shimPromise) return shimPromise;
  shimPromise = (async () => {
    try {
      const dir = path.join(os.tmpdir(), 'nuaa-oj-include');
      const bits = path.join(dir, 'bits');
      await fs.promises.mkdir(bits, { recursive: true });
      const headers = [
        'algorithm', 'array', 'bitset', 'cassert', 'cctype', 'cerrno', 'cfloat', 'chrono', 'cinttypes',
        'climits', 'cmath', 'complex', 'cstdarg', 'cstddef', 'cstdint', 'cstdio', 'cstdlib', 'cstring',
        'ctime', 'deque', 'functional', 'iomanip', 'ios', 'iostream', 'istream', 'iterator', 'limits',
        'list', 'map', 'memory', 'numeric', 'ostream', 'queue', 'random', 'set', 'sstream', 'stack',
        'string', 'tuple', 'type_traits', 'unordered_map', 'unordered_set', 'utility', 'vector',
      ];
      const content = headers.map((h) => `#include <${h}>`).join('\n') + '\n';
      await fs.promises.writeFile(path.join(bits, 'stdc++.h'), content, 'utf8');
      return dir;
    } catch {
      return undefined;
    }
  })();
  return shimPromise;
}

function shellSplit(s: string): string[] {
  return (s || '').match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((x) => x.replace(/^["']|["']$/g, '')) ?? [];
}

function isMsvcCl(compiler: string): boolean {
  return /(^|[\\/])cl(\.exe)?$/i.test(compiler) || compiler.trim().toLowerCase() === 'cl';
}

/**
 * Compiler standard/optimization flags that mirror the OJ's own per-language compileCommand, so
 * local testing uses the SAME C/C++ standard as the selected submission language
 * (C++ = c++14, C++ 17 = c++17, C++ 20 = c++20, and "With O2" adds -O2).
 */
function langStdFlags(language: string, compiler: string, isWindows: boolean): { flags: string[]; addLm: boolean } {
  const l = (language || '').toLowerCase();
  const cl = isMsvcCl(compiler);
  const o2 = /with o2/.test(l);
  let std: string | undefined;
  let isC = false;
  if (l === 'c' || l === 'c with o2') {
    std = 'c11';
    isC = true;
  } else if (l.startsWith('c++') || l === 'cpp') {
    std = /20/.test(l) ? 'c++20' : /17/.test(l) ? 'c++17' : 'c++14';
  }
  const flags: string[] = [];
  if (o2) flags.push(cl ? '/O2' : '-O2');
  if (std) flags.push(cl ? `/std:${std}` : `-std=${std}`);
  return { flags, addLm: isC && !cl };
}

export function buildPlan(
  language: string,
  sourcePath: string,
  isWindows: boolean,
  cfg: RunnerConfig,
  extraInclude?: string,
): Plan {
  const ext = path.extname(sourcePath).toLowerCase();
  const base = path.basename(sourcePath, ext);
  const exeSuffix = isWindows ? '.exe' : '';
  const inc = extraInclude ? ['-I', extraInclude] : [];

  if (language === 'C' || language === 'C With O2' || ext === '.c') {
    const outName = base + exeSuffix;
    const { flags, addLm } = langStdFlags(language, cfg.c, isWindows);
    return {
      compile: {
        command: cfg.c,
        args: (src, outDir) => [...flags, ...shellSplit(cfg.cArgs), ...inc, src, '-o', path.join(outDir, outName), ...(addLm ? ['-lm'] : [])],
      },
      run: (_src, outDir) => ({ command: path.join(outDir, outName), args: [] }),
    };
  }
  if (/^C\+\+/i.test(language) || ['.cpp', '.cc', '.cxx'].includes(ext)) {
    const outName = base + exeSuffix;
    const { flags } = langStdFlags(language, cfg.cpp, isWindows);
    return {
      compile: {
        command: cfg.cpp,
        args: (src, outDir) => [...flags, ...shellSplit(cfg.cppArgs), ...inc, src, '-o', path.join(outDir, outName)],
      },
      run: (_src, outDir) => ({ command: path.join(outDir, outName), args: [] }),
    };
  }
  if (language === 'Java' || ext === '.java') {
    const cls = base;
    return {
      compile: { command: cfg.java, args: (src, outDir) => ['-encoding', 'UTF-8', '-d', outDir, src] },
      run: (_src, outDir) => ({ command: cfg.javaRun, args: ['-Dfile.encoding=UTF-8', '-cp', outDir, cls] }),
    };
  }
  if (/^(Python|PyPy)/i.test(language) || ext === '.py') {
    return { run: (src) => ({ command: cfg.python, args: ['-u', src] }) };
  }
  if (language === 'Golang' || ext === '.go') {
    return { run: (src) => ({ command: cfg.go, args: ['run', src] }) };
  }
  if (/^JavaScript/i.test(language) || ext === '.js') {
    return { run: (src) => ({ command: cfg.javascript, args: [src] }) };
  }
  if (language === 'Rust' || ext === '.rs') {
    const outName = base + exeSuffix;
    return {
      compile: { command: cfg.rust, args: (src, outDir) => ['-O', src, '-o', path.join(outDir, outName)] },
      run: (_src, outDir) => ({ command: path.join(outDir, outName), args: [] }),
    };
  }
  if (language === 'PHP' || ext === '.php') {
    return { run: (src) => ({ command: cfg.php, args: ['-d', 'error_reporting=0', src] }) };
  }
  if (language === 'Ruby' || ext === '.rb') {
    return { run: (src) => ({ command: cfg.ruby, args: [src] }) };
  }
  return { run: (src) => ({ command: '', args: [src] }) };
}

export function isLocallyRunnable(language: string, sourcePath: string): boolean {
  const ext = path.extname(sourcePath).toLowerCase();
  return (
    /^(C|C\+\+|Java|Python|PyPy|Golang|JavaScript|Rust|PHP|Ruby)/i.test(language) ||
    ['.c', '.cpp', '.cc', '.cxx', '.java', '.py', '.go', '.js', '.rs', '.php', '.rb'].includes(ext)
  );
}

export async function runSamples(
  sourcePath: string,
  language: string,
  samples: Sample[],
  timeLimitMs: number,
  cfg: RunnerConfig,
  onProgress?: (msg: string) => void,
  fileIO?: { readFileName: string; writeFileName: string },
): Promise<RunResult> {
  const isWindows = process.platform === 'win32';
  const srcExt = path.extname(sourcePath).toLowerCase();
  const isC = language === 'C' || language === 'C With O2' || srcExt === '.c';
  const compilerName = isC ? cfg.c : cfg.cpp;
  let extraInclude: string | undefined;
  if (/clang/i.test(compilerName)) {
    extraInclude = await ensureBitsShim();
  }
  const plan = buildPlan(language, sourcePath, isWindows, cfg, extraInclude);
  const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nuaa-oj-'));
  const outDir = path.join(workRoot, 'bin');
  await fs.promises.mkdir(outDir, { recursive: true });
  const extra = cfg.timeLimitExtraMs;
  const totalStart = Date.now();

  const runCmd = plan.run('', '');
  if (!runCmd || !runCmd.command) {
    await fs.promises.rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, language, cases: [], totalTimeMs: 0, skipped: `不支持的语言：${language}` };
  }

  try {
    if (plan.compile) {
      onProgress?.('正在编译…');
      const args = plan.compile.args(sourcePath, outDir);
      const comp = await runProcess(plan.compile.command, args, { cwd: outDir, timeoutMs: 30000 });
      if (comp.spawnError) {
        return {
          ok: false,
          language,
          cases: [],
          totalTimeMs: Date.now() - totalStart,
          skipped: `无法启动编译器「${plan.compile.command}」：${comp.spawnError}。请检查设置 nuaaOj.compiler.*（例如安装 g++ 并加入 PATH）。`,
        };
      }
      if (comp.timedOut || comp.code !== 0) {
        return {
          ok: false,
          language,
          cases: [],
          totalTimeMs: Date.now() - totalStart,
          compileError: (comp.stderr || comp.stdout || '编译失败').trim(),
        };
      }
    }

    const cases: CaseResult[] = [];
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      onProgress?.(`运行样例 ${i + 1}/${samples.length} …`);
      const { command, args } = plan.run(sourcePath, outDir);
      if (fileIO && fileIO.readFileName) {
        try { fs.writeFileSync(path.join(outDir, fileIO.readFileName), sample.input); } catch { /* ignore */ }
        try { fs.rmSync(path.join(outDir, fileIO.writeFileName), { force: true }); } catch { /* ignore */ }
      }
      const r = await runProcess(command, args, {
        cwd: outDir,
        stdin: fileIO ? undefined : sample.input,
        timeoutMs: timeLimitMs + extra,
      });
      let actual = r.stdout;
      if (fileIO && fileIO.writeFileName) {
        try { actual = fs.readFileSync(path.join(outDir, fileIO.writeFileName), 'utf8'); } catch { actual = ''; }
      }
      let status: CaseStatus;
      if (r.spawnError) status = 'RE';
      else if (r.timedOut) status = 'TLE';
      else if (r.code !== 0) status = 'RE';
      else if (compare(sample.output, actual)) status = 'AC';
      else status = 'WA';
      cases.push({
        index: i + 1,
        input: sample.input,
        expected: sample.output,
        actual,
        stderr: r.spawnError ? `${r.spawnError}\n${r.stderr}` : r.stderr,
        status,
        timeMs: r.timeMs,
      });
    }
    return { ok: cases.every((c) => c.status === 'AC'), language, cases, totalTimeMs: Date.now() - totalStart };
  } finally {
    fs.promises.rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
