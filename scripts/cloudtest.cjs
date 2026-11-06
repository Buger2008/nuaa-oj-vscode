const Module = require('module');
const orig = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');
const fileUri = (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => p });
const vscodeMock = {
  Uri: { file: fileUri, joinPath: (b, ...p) => fileUri([typeof b === 'string' ? b : b.fsPath || b.path, ...p].join('/').replace(/\/+/g, '/')) },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (k, d) => (k === 'nuaaOj.problemFolder' ? 'NUAA-OJ' : k === 'nuaaOj.baseUrl' ? 'https://oj.nuaa.edu.cn' : k === 'nuaaOj.cloudTest.intervalMs' ? 5500 : d) }),
    fs: {
      stat: async (u) => ({ type: fs.statSync(u.fsPath).isDirectory() ? 2 : 1 }),
      readFile: async (u) => fs.readFileSync(u.fsPath),
      writeFile: async (u, data) => fs.writeFileSync(u.fsPath, Buffer.from(data)),
      createDirectory: async (u) => fs.mkdirSync(u.fsPath, { recursive: true }),
      readDirectory: async (u) => fs.readdirSync(u.fsPath, { withFileTypes: true }).map((d) => [d.name, d.isDirectory() ? 2 : 1]),
    },
    openTextDocument: async (u) => ({ uri: u, getText: () => fs.readFileSync(u.fsPath, 'utf8'), positionAt: (n) => ({ n }), save: async () => {} }),
  },
  window: { activeTextEditor: undefined, showInformationMessage: async () => undefined, showWarningMessage: async () => undefined, setStatusBarMessage: () => ({}) },
  env: { clipboard: { writeText() {} } },
};
Module._load = function (r) { if (r === 'vscode') return vscodeMock; return orig.apply(this, arguments); };

const { OjApi } = require('../out/api.js');
(async () => {
  const api = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn' });
  const { token, user } = await api.login('162610126', 'oj162610126oj');
  const api2 = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn', getToken: () => token });
  const auth = { ensureLoggedIn: async () => true, api: api2, currentUser: user };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-')).replace(/\\/g, '/');
  vscodeMock.workspace.workspaceFolders = [{ uri: fileUri(work) }];
  const { NuaaOjService } = require('../out/service.js');
  const service = new NuaaOjService(auth, { appendLine() {}, append() {}, show() {}, dispose() {} }, { subscriptions: [], extensionUri: fileUri('/ext') }, fileUri('/ext'), () => {});
  const folder = path.join(work, 'NUAA-OJ', 'E1 A+B 输入输出练习I');
  fs.mkdirSync(folder, { recursive: true });
  const ccode = '#include <stdio.h>\nint main(){int a,b;while(scanf("%d %d",&a,&b)==2)printf("%d\\n",a+b);return 0;}\n';
  fs.writeFileSync(path.join(folder, 'E1.c'), ccode);
  const ctx = { version: 1, kind: 'problem', displayId: 'E1', pid: 1110, title: 'A+B 输入输出练习I', timeLimit: 1000, memoryLimit: 256, isFileIO: false, samples: [{ input: '1 5', output: '6' }, { input: '10 20', output: '30' }], allowedLanguages: ['C', 'C++'], url: 'u', solutionFile: 'E1.c', selectedLanguage: 'C', language: 'C' };
  const t0 = Date.now();
  const res = await service.runCloudTest(ctx, (m) => console.log('  progress:', m));
  console.log('RESULT ok=', res.ok, 'lang=', res.language, 'totalMs=', res.totalTimeMs, 'realMs=', Date.now() - t0);
  console.log('cases:', res.cases.map((c) => ({ i: c.index, status: c.status, actual: JSON.stringify(c.actual), time: c.timeMs, stderr: c.stderr&&c.stderr.slice(0,40) })));
  fs.rmSync(work, { recursive: true, force: true });
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
