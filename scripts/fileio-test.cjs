const Module = require('module'); const orig = Module._load; const fs = require('fs'); const os = require('os'); const path = require('path');
const fileUri = (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => p });
const vscodeMock = {
  Uri: { file: fileUri, joinPath: (b, ...p) => fileUri([typeof b === 'string' ? b : b.fsPath || b.path, ...p].join('/').replace(/\/+/g, '/')) },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (k, d) => (k === 'nuaaOj.problemFolder' ? 'NUAA-OJ' : k === 'nuaaOj.baseUrl' ? 'https://oj.nuaa.edu.cn' ? 'https://oj.nuaa.edu.cn' : d : d) }),
    fs: { stat: async (u) => ({ type: fs.statSync(u.fsPath).isDirectory() ? 2 : 1 }), readFile: async (u) => fs.readFileSync(u.fsPath), writeFile: async (u, d) => fs.writeFileSync(u.fsPath, Buffer.from(d)), createDirectory: async (u) => fs.mkdirSync(u.fsPath, { recursive: true }), readDirectory: async (u) => fs.readdirSync(u.fsPath, { withFileTypes: true }).map((d) => [d.name, d.isDirectory() ? 2 : 1]) },
    openTextDocument: async (u) => ({ uri: u, getText: () => fs.readFileSync(u.fsPath, 'utf8'), positionAt: (n) => ({ n }), save: async () => {} }),
  },
  window: { activeTextEditor: undefined }, env: { clipboard: { writeText() {} } },
};
Module._load = function (r) { if (r === 'vscode') return vscodeMock; return orig.apply(this, arguments); };
const { OjApi } = require('../out/api.js');
(async () => {
  const api = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn' }); const { token, user } = await api.login('162610126', 'oj162610126oj');
  const api2 = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn', getToken: () => token });
  const auth = { ensureLoggedIn: async () => true, api: api2, currentUser: user };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fileio-')).replace(/\\/g, '/'); vscodeMock.workspace.workspaceFolders = [{ uri: fileUri(work) }];
  const ctxMod = require('../out/context.js');
  const { NuaaOjService } = require('../out/service.js');
  const service = new NuaaOjService(auth, { appendLine() {}, append() {}, show() {}, dispose() {} }, { subscriptions: [], extensionUri: fileUri('/ext') }, fileUri('/ext'), () => {});
  const ctx = { version: 1, kind: 'problem', displayId: '9998', pid: 1630, title: '文件操作 - 数列排序', timeLimit: 1000, memoryLimit: 512, isFileIO: true, ioReadFileName: 'file1.txt', ioWriteFileName: 'file2.txt', samples: [{ input: '5\n8 3 6 4 9', output: '3 4 6 8 9' }], allowedLanguages: ['C', 'C++'], url: 'u', solutionFile: 'sol.c', language: 'C', selectedLanguage: 'C' };
  const folder = ctxMod.problemFolderUri(ctx); fs.mkdirSync(folder.fsPath, { recursive: true });
  const code = [
    '#include <stdio.h>', '#include <stdlib.h>',
    'int cmp(const void*a,const void*b){return *(int*)a-*(int*)b;}',
    'int main(){FILE*fi=fopen("file1.txt","r"); if(!fi)return 1; int n; if(fscanf(fi,"%d",&n)!=1){fclose(fi);return 0;} int a[1000]; for(int i=0;i<n;i++)fscanf(fi,"%d",&a[i]); fclose(fi); qsort(a,n,sizeof(int),cmp); FILE*fo=fopen("file2.txt","w"); for(int i=0;i<n;i++){ if(i) fprintf(fo," "); fprintf(fo,"%d",a[i]); } fclose(fo); return 0;}',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(folder.fsPath, 'sol.c'), code);
  const res = await service.runTest(ctx);
  console.log('LOCAL FILE-IO runTest:', JSON.stringify({ ok: res.ok, skipped: res.skipped, compileError: res.compileError }));
  console.log('cases:', JSON.stringify((res.cases || []).map((c) => ({ status: c.status, expected: c.expected, actual: c.actual, time: c.timeMs }))));
  fs.rmSync(work, { recursive: true, force: true });
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
