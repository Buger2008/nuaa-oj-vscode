const Module = require('module');
const orig = Module._load;
const fs = require('fs');
const os = require('os');
const path = require('path');

const fileUri = (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => p });
class Range { constructor(a, b) { this.start = a; this.end = b; } }
class WorkspaceEdit { constructor() { this.reps = []; } replace(uri, range, text) { this.reps.push({ uri, text }); } }

let confirmEnabled = true;

const vscodeMock = {
  Uri: { file: fileUri, joinPath: (b, ...p) => fileUri([typeof b === 'string' ? b : b.fsPath || b.path, ...p].join('/').replace(/\/+/g, '/')) },
  Range,
  WorkspaceEdit,
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (k, d) => (k === 'nuaaOj.problemFolder' ? 'NUAA-OJ' : k === 'nuaaOj.baseUrl' ? 'https://oj.nuaa.edu.cn' : k === 'nuaaOj.defaultLanguage' ? 'C++' : d) }),
    fs: {
      stat: async (u) => ({ type: fs.statSync(u.fsPath).isDirectory() ? 2 : 1 }),
      readFile: async (u) => fs.readFileSync(u.fsPath),
      writeFile: async (u, data) => fs.writeFileSync(u.fsPath, Buffer.from(data)),
      createDirectory: async (u) => fs.mkdirSync(u.fsPath, { recursive: true }),
      readDirectory: async (u) => fs.readdirSync(u.fsPath, { withFileTypes: true }).map((d) => [d.name, d.isDirectory() ? 2 : 1]),
    },
    openTextDocument: async (u) => ({ uri: u, getText: () => fs.readFileSync(u.fsPath, 'utf8'), positionAt: (n) => ({ n }), save: async () => {} }),
    applyEdit: async (edit) => { for (const rep of edit.reps) fs.writeFileSync(rep.uri.fsPath, rep.text); return true; },
  },
  window: {
    activeTextEditor: undefined,
    showWarningMessage: async (msg, opts, ...items) => {
      if (!confirmEnabled) return undefined;
      if (String(msg).includes('覆盖')) return items.find((i) => String(i).includes('覆盖'));
      return undefined;
    },
    showInformationMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showTextDocument: async () => ({}),
    setStatusBarMessage: () => ({}),
  },
  env: { clipboard: { writeText() {} } },
};

Module._load = function (r) { if (r === 'vscode') return vscodeMock; return orig.apply(this, arguments); };

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

  const folder = path.join(work, 'NUAA-OJ', 'E1 A+B 输入输出练习I');
  fs.mkdirSync(folder, { recursive: true });
  const baseCtx = { version: 1, kind: 'problem', displayId: 'E1', pid: 1110, title: 'A+B 输入输出练习I', timeLimit: 1000, memoryLimit: 256, isFileIO: false, samples: [], allowedLanguages: ['C', 'C++', 'Python3'], url: 'u' };

  // 1) same language (E1.py, last AC is Python3) -> overwrite current file
  fs.writeFileSync(path.join(folder, 'E1.py'), 'print("old")\n');
  const ctx1 = { ...baseCtx, solutionFile: 'E1.py' };
  const r1 = await service.loadLastAcceptedCode(ctx1);
  console.log('SAME-LANG:', JSON.stringify({ ok: r1.ok, switched: r1.switched, file: r1.fileName, lang: r1.language }), '| py has AC?', fs.readFileSync(path.join(folder, 'E1.py'), 'utf8').includes('import sys'));

  // 2) different language: current file E1.cpp, last AC is Python3 -> should switch to E1.py and write there
  fs.writeFileSync(path.join(folder, 'E1.cpp'), 'int main(){return 0;} // my cpp\n');
  const ctx2 = { ...baseCtx, solutionFile: 'E1.cpp' };
  const r2 = await service.loadLastAcceptedCode(ctx2);
  console.log('DIFF-LANG:', JSON.stringify({ ok: r2.ok, switched: r2.switched, file: r2.fileName, lang: r2.language }),
    '| switched to E1.py?', r2.fileName === 'E1.py',
    '| py has AC?', fs.existsSync(path.join(folder, 'E1.py')) && fs.readFileSync(path.join(folder, 'E1.py'), 'utf8').includes('import sys'),
    '| cpp untouched?', fs.readFileSync(path.join(folder, 'E1.cpp'), 'utf8').includes('my cpp'));

  // 3) never AC
  const ctx3 = { version: 1, kind: 'problem', displayId: 'NUAA2023_J', pid: 1602, title: 'x', timeLimit: 1000, memoryLimit: 256, isFileIO: false, samples: [], allowedLanguages: ['C'], url: 'u', solutionFile: 'NUAA2023_J.c' };
  const f3 = path.join(work, 'NUAA-OJ', 'NUAA2023_J x'); fs.mkdirSync(f3, { recursive: true }); fs.writeFileSync(path.join(f3, 'NUAA2023_J.c'), 'int main(){}\n');
  const r3 = await service.loadLastAcceptedCode(ctx3);
  console.log('NEVER-AC:', JSON.stringify(r3));

  // 4) cancelled
  confirmEnabled = false;
  fs.writeFileSync(path.join(folder, 'E1.cpp'), 'keep cpp\n');
  const r4 = await service.loadLastAcceptedCode(ctx2);
  console.log('CANCEL:', JSON.stringify({ ok: r4.ok, cancelled: r4.cancelled }), '| kept?', fs.readFileSync(path.join(folder, 'E1.cpp'), 'utf8') === 'keep cpp\n');

  fs.rmSync(work, { recursive: true, force: true });
})().catch((e) => { console.error('FAILED', e); process.exit(1); });

