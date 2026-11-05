const fs = require('fs'), os = require('os'), path = require('path');
const { runSamples } = require('../out/runner.js');
const cfg = {
  c: 'clang', cArgs: '-O2 -std=c11', cpp: 'clang++', cppArgs: '-O2 -std=c++17',
  java: 'javac', javaRun: 'java', python: process.platform === 'win32' ? 'python' : 'python3',
  javascript: 'node', go: 'go', rust: 'rustc', timeLimitExtraMs: 1000,
};
const samples = [{ input: '1 5', output: '6' }, { input: '10 20', output: '30' }];
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpptest-'));
  // C++ using bits/stdc++.h (needs shim under clang/libc++)
  const f = path.join(dir, 'E1.cpp');
  fs.writeFileSync(f, '#include <bits/stdc++.h>\nusing namespace std;\nint main(){int a,b;while(cin>>a>>b)cout<<a+b<<"\\n";}\n');
  const r = await runSamples(f, 'C++', samples, 1000, cfg);
  console.log('C++ bits/stdc++.h:', r.ok ? 'ALL AC' : 'FAIL', r.cases.map(c => c.status).join(','), r.compileError ? ('CE:' + r.compileError.slice(0, 160)) : '');
  fs.rmSync(dir, { recursive: true, force: true });
})();
