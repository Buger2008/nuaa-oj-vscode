const Module = require('module');
const orig = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');

const fileUri = (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => p });
class Range { constructor(a, b) { this.start = a; this.end = b; } }
class WorkspaceEdit { constructor() { this.reps = []; } replace(uri, range, text) { this.reps.push({ uri, text }); } }

let confirmAnswer = '覆盖';

const vscodeMock = {
  Uri: { file: fileUri, joinPath: (b, ...p) => fileUri([typeof b === 'string' ? b : b.fsPath || b.path, ...p].join('/').replace(/\/+/g, '/')) },
  Range,
  WorkspaceEdit,
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (k, d) => (k === 'nuaaOj.problemFolder' ? 'NUAA-OJ' : k === 'nuaaOj.baseUrl' ? 'https://oj.nuaa.edu.cn' : d) }),
    fs: {
      stat: async (u) => ({ type: fs.statSync(u.fsPath).isDirectory() ? 2 : 1 }),
      readFile: async (u) => fs.readFileSync(u.fsPath),
      writeFile: async (u, data) => fs.writeFileSync(u.fsPath, Buffer.from(data)),
      createDirectory: async (u) => fs.mkdirSync(u.fsPath, { recursive: true }),
      readDirectory: async (u) => fs.readdirSync(u.fsPath, { withFileTypes: true }).map((d) => [d.name, d.isDirectory() ? 2 : 1]),
    },
    openTextDocument: async (u) => ({
      uri: u,
      getText: () => fs.readFileSync(u.fsPath, 'utf8'),
      positionAt: (n) => ({ n }),
      save: async () => {},
    }),
    applyEdit: async (edit) => { for (const rep of edit.reps) fs.writeFileSync(rep.uri.fsPath, rep.text); return true; },
  },
  window: {
    activeTextEditor: undefined,
    showWarningMessage: async (msg, opts, ...items) => (String(msg).includes('覆盖') && items.includes('覆盖') ? confirmAnswer : undefined),
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    setStatusBarMessage: () => ({}),
  },
  env: { clipboard: { writeText() {} } },
};

Module._load = function (r) {
  if (r === 'vscode') return vscodeMock;
  return orig.apply(this, arguments);
};

const { OjApi } = require('../out/api.js');

(async () => {
  const api = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn' });
  const { token, user } = await api.login('162610126', 'oj162610126oj');
  const api2 = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn', getToken: () => token });
  const auth = { ensureLoggedIn: async () => true, api: api2, currentUser: user };
  const output = { appendLine() {}, append() {}, show() {}, dispose() {} };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lastac-')).replace(/\\/g, '/');
  vscodeMock.workspace.workspaceFolders = [{ uri: fileUri(work) }];

  const { NuaaOjService } = require('../out/service.js');
  const service = new NuaaOjService(auth, output, { subscriptions: [], extensionUri: fileUri('/ext') }, fileUri('/ext'), () => {});

  const ctx = { version: 1, kind: 'problem', displayId: 'E1', pid: 1110, title: 'A+B 输入输出练习I', timeLimit: 1000, memoryLimit: 256, isFileIO: false, samples: [], allowedLanguages: ['C', 'C++', 'Python3'], url: 'u', solutionFile: 'E1.py' };
  const folder = path.join(work, 'NUAA-OJ', 'E1 A+B 输入输出练习I');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'E1.py'), 'print("old placeholder")\n');

  const res = await service.loadLastAcceptedCode(ctx);
  const after = fs.readFileSync(path.join(folder, 'E1.py'), 'utf8');
  console.log('E1 loadLastAcceptedCode:', JSON.stringify(res));
  console.log('  overwritten?', after.includes('import sys') || after.includes('print('), '| len', after.length, '| has metadata footer?', after.includes('@runId'));

  const ctx2 = { version: 1, kind: 'problem', displayId: 'NUAA2023_J', pid: 1602, title: 'x', timeLimit: 1000, memoryLimit: 256, isFileIO: false, samples: [], allowedLanguages: ['C'], url: 'u', solutionFile: 'NUAA2023_J.c' };
  const f2 = path.join(work, 'NUAA-OJ', 'NUAA2023_J x');
  fs.mkdirSync(f2, { recursive: true });
  fs.writeFileSync(path.join(f2, 'NUAA2023_J.c'), 'int main(){}\n');
  const res2 = await service.loadLastAcceptedCode(ctx2);
  console.log('NEVER-AC:', JSON.stringify(res2));

  confirmAnswer = undefined;
  fs.writeFileSync(path.join(folder, 'E1.py'), 'keep me\n');
  const res3 = await service.loadLastAcceptedCode(ctx);
  console.log('CANCEL:', JSON.stringify(res3), '| kept?', fs.readFileSync(path.join(folder, 'E1.py'), 'utf8') === 'keep me\n');

  fs.rmSync(work, { recursive: true, force: true });
})().catch((e) => { console.error('FAILED', e); process.exit(1); });

