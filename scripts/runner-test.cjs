// Standalone test of the local runner (no vscode needed).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSamples } = require('../out/runner.js');

const cfg = {
  c: 'gcc', cArgs: '-O2 -std=c11 -lm',
  cpp: 'g++', cppArgs: '-O2 -std=c++17',
  java: 'javac', javaRun: 'java',
  python: process.platform === 'win32' ? 'python' : 'python3',
  javascript: 'node', go: 'go', rust: 'rustc',
  timeLimitExtraMs: 1000,
};

const samples = [
  { input: '1 5\n', output: '6\n' },
  { input: '10 20\n', output: '30\n' },
];

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));

  // Python AC
  const py = path.join(dir, 'main.py');
  fs.writeFileSync(py, 'import sys\nfor line in sys.stdin:\n    a,b=line.split()\n    print(int(a)+int(b))\n');
  const pyRes = await runSamples(py, 'Python3', samples, 1000, cfg);
  console.log('PYTHON:', pyRes.ok ? 'AC' : 'FAIL', pyRes.cases.map(c => c.status + '(' + c.timeMs + 'ms)').join(','));
  if (!pyRes.ok) console.log(pyRes);

  // Java AC
  const java = path.join(dir, 'Main.java');
  fs.writeFileSync(java, 'import java.util.*;\npublic class Main{public static void main(String[] a){Scanner s=new Scanner(System.in);while(s.hasNextInt())System.out.println(s.nextInt()+s.nextInt());}}\n');
  const jRes = await runSamples(java, 'Java', samples, 1000, cfg);
  console.log('JAVA:', jRes.ok ? 'AC' : 'FAIL', jRes.compileError ? ('CE:' + jRes.compileError.slice(0,120)) : jRes.cases.map(c => c.status).join(','));

  // Python WA (wrong output)
  const pyW = path.join(dir, 'wrong.py');
  fs.writeFileSync(pyW, 'print(0)\n');
  const wRes = await runSamples(pyW, 'Python3', samples, 1000, cfg);
  console.log('WRONG:', wRes.ok ? 'UNEXPECTED AC' : 'WA as expected', wRes.cases.map(c => c.status).join(','));

  // Java compile error
  const bad = path.join(dir, 'Bad.java');
  fs.writeFileSync(bad, 'public class Bad { void f( { } }\n');
  const bRes = await runSamples(bad, 'Java', samples, 1000, cfg);
  console.log('COMPILE-ERR:', bRes.compileError ? 'CE as expected' : 'NO CE', (bRes.compileError||'').slice(0,80).replace(/\n/g,' '));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nRUNNER TESTS DONE');
})().catch(e => { console.error('RUNNER TEST FAILED:', e); process.exit(1); });
