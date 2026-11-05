// End-to-end integration test of NuaaOjService against the live OJ.
// vscode is mocked; filesystem + network are real.
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');

class EventEmitter { constructor(){ this.event = () => ({ dispose(){} }); } fire(){} dispose(){} }
class TreeItem { constructor(l,s){ this.label=l; this.collapsibleState=s; } }
class ThemeIcon { constructor(id){ this.id=id; } }
const fileUri = (p) => ({ scheme:'file', fsPath:p, path:p, toString:()=>p });
const Uri = {
  parse: (s)=>({ scheme:'https', fsPath:s, path:s, toString:()=>s }),
  file: fileUri,
  joinPath: (base, ...parts) => {
    const b = typeof base === 'string' ? base : (base.fsPath || base.path || '');
    return fileUri([b, ...parts].join('/').replace(/\/+/g,'/'));
  },
};

const CFG = {
  baseUrl: 'https://oj.nuaa.edu.cn',
  defaultLanguage: 'Python3',
  problemFolder: 'NUAA-OJ',
  autoCreateFile: true,
  openStatementOnOpen: true,
  'submit.confirm': false,
  pollIntervalMs: 500,
  pollTimeoutMs: 60000,
  'test.timeLimitExtraMs': 1000,
  'compiler.c': 'gcc', 'compiler.cArgs': '-O2 -std=c11 -lm',
  'compiler.cpp': 'g++', 'compiler.cppArgs': '-O2 -std=c++17',
  'compiler.java': 'javac', 'compiler.javaRun': 'java',
  'compiler.python': process.platform === 'win32' ? 'python' : 'python3',
  'compiler.javascript': 'node', 'compiler.go': 'go', 'compiler.rust': 'rustc',
};
const cfgObj = { get: (k, d) => (k in CFG ? CFG[k] : d), update: async () => {} };

function fsType(t){ return t.isDirectory() ? 2 : 1; }
const wfs = {
  stat: async (u) => { const s = await fs.promises.stat(u.fsPath); return { type: fsType(s) }; },
  readFile: async (u) => fs.promises.readFile(u.fsPath),
  writeFile: async (u, data) => fs.promises.writeFile(u.fsPath, Buffer.from(data)),
  createDirectory: async (u) => fs.promises.mkdir(u.fsPath, { recursive: true }),
  readDirectory: async (u) => (await fs.promises.readdir(u.fsPath, { withFileTypes: true })).map(d => [d.name, fsType(d)]),
};

let activeEditor;
let inputBoxReturn; // used to simulate the "file exists, rename" prompt
const vscode = {
  EventEmitter, TreeItem, ThemeIcon,
  TreeItemCollapsibleState: { None:0, Collapsed:1, Expanded:2 },
  StatusBarAlignment: { Left:1, Right:2 },
  ViewColumn: { Active:-1, Beside:-2, One:1, Two:2 },
  ProgressLocation: { Notification:15 },
  ConfigurationTarget: { Global:1 },
  FileType: { File:1, Directory:2 },
  Uri,
  window: {
    get activeTextEditor(){ return activeEditor; },
    createOutputChannel: () => ({ appendLine:(s)=>console.log('OUT:', s), append(){}, show(){}, dispose(){} }),
    createStatusBarItem: () => ({ show(){}, hide(){}, dispose(){}, text:'', tooltip:'', command:'' }),
    registerTreeDataProvider: () => ({ dispose(){} }),
    onDidChangeActiveTextEditor: () => ({ dispose(){} }),
    showInputBox: async () => inputBoxReturn,
    showInformationMessage: async (...a)=>{ console.log('INFO:', a[0]); return undefined; },
    showWarningMessage: async (...a)=>{ console.log('WARN:', a[0]); return undefined; },
    showErrorMessage: async (...a)=>{ console.log('ERRMSG:', a[0]); return undefined; },
    showTextDocument: async () => ({}),
    createWebviewPanel: () => {
      const panel = { webview: { html:'', cspSource:'vscode-resource:', onDidReceiveMessage(){}, postMessage(){}, asWebviewUri:(u)=>u }, onDidDispose(){}, reveal(){}, dispose(){}, title:'' };
      return panel;
    },
    withProgress: async (_o, fn) => fn(),
    setStatusBarMessage: () => ({ dispose(){} }),
  },
  workspace: {
    getConfiguration: () => cfgObj,
    workspaceFolders: undefined, // set later
    fs: wfs,
    openTextDocument: async (u) => ({ uri: u, getText: () => fs.readFileSync(u.fsPath, 'utf8') }),
    onDidChangeActiveTextEditor: () => ({ dispose(){} }),
  },
  commands: { registerCommand: () => ({ dispose(){} }), executeCommand: async () => undefined },
  env: { clipboard: { readText: async () => '', writeText(){} }, openExternal(){} },
  l10n: { t: (s)=>s },
};

const origLoad = Module._load;
Module._load = function (request) { if (request === 'vscode') return vscode; return origLoad.apply(this, arguments); };

(async () => {
  const { AuthManager } = require('../out/auth.js');
  const { NuaaOjService } = require('../out/service.js');
  const { ProblemPanel } = require('../out/problemPanel.js');
  const { cleanupTempRoot, getTempRootPath } = require('../out/context.js');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nuaa-e2e-')).replace(/\\/g,'/');
  vscode.workspace.workspaceFolders = [{ uri: fileUri(work) }];

  const secretsStore = {};
  const context = {
    subscriptions: [],
    extensionUri: fileUri(path.join(__dirname, '..').replace(/\\/g,'/')),
    secrets: { get: async (k)=>secretsStore[k], store: async (k,v)=>{secretsStore[k]=v;}, delete: async (k)=>{delete secretsStore[k];} },
    globalState: { get:()=>undefined, update: async()=>{} },
    workspaceState: { get:()=>undefined, update: async()=>{} },
  };

  const output = { appendLine:(s)=>console.log('OUT:', s), append(){}, show(){}, dispose(){} };
  const auth = new AuthManager(context);
  const user = await auth.login('162610126', 'oj162610126oj');
  console.log('LOGIN:', user.username, user.nickname);

  const service = new NuaaOjService(auth, output, context, context.extensionUri, ()=>{});

  // 1) open problem E1 -> creates folder/file/meta + panel
  await service.openProblem('E1');

  // locate solution file
  const baseDir = path.join(work, 'NUAA-OJ');
  const folders = fs.readdirSync(baseDir);
  const probDir = path.join(baseDir, folders[0]);
  const files = fs.readdirSync(probDir);
  console.log('CREATED FILES:', files.join(', '));
  const pyFile = files.find(f => f.endsWith('.py'));
  const meta = JSON.parse(fs.readFileSync(path.join(probDir, '.nuaa-oj.json'), 'utf8'));
  console.log('META:', { displayId: meta.displayId, pid: meta.pid, title: meta.title, samples: meta.samples.length, language: meta.language, solutionFile: meta.solutionFile });

  // 2) write a correct python solution
  const solPath = path.join(probDir, pyFile);
  console.log('E1 file initial content length:', fs.readFileSync(solPath, 'utf8').length, '(expected 0 = empty, E1 has no template)');
  fs.writeFileSync(solPath, 'import sys\nfor line in sys.stdin:\n    p=line.split()\n    if len(p)>=2: print(int(p[0])+int(p[1]))\n');
  activeEditor = { document: { uri: fileUri(solPath), } };
  const ctx = await service.contextFromActiveEditor();
  if (!ctx) throw new Error('contextFromActiveEditor returned undefined');
  console.log('CTX from active editor:', ctx.displayId, ctx.kind, 'samples=', ctx.samples.length);

  // 3) local test
  const testRes = await service.runTest(ctx);
  console.log('LOCAL TEST:', testRes.ok ? 'ALL AC' : 'NOT ALL AC', 'cases=', testRes.cases.map(c=>c.status).join(','), 'skipped=', testRes.skipped || '-');

  // 4) submit + poll
  let lastProg = '';
  const sub = await service.submit(ctx, (t)=>{ lastProg = t; });
  console.log('SUBMIT RESULT:', JSON.stringify({ submitId: sub && sub.submitId, status: sub && sub.status && sub.status.short, time: sub && sub.time, memory: sub && sub.memory, score: sub && sub.score, cases: sub && sub.cases && sub.cases.length, errorMessage: sub && sub.errorMessage, error: sub && sub.error }));

  // 5) open the SAME problem again -> should resume the existing file (no new file, no overwrite)
  const marker = '// MY_WORK_IN_PROGRESS\n';
  fs.appendFileSync(path.join(probDir, 'E1.py'), marker);
  const ctx2 = await service.openProblem('E1');
  const e1py = fs.readFileSync(path.join(probDir, 'E1.py'), 'utf8');
  console.log('SECOND OPEN solutionFile:', ctx2 && ctx2.solutionFile,
    '| E1-2.py exists (should be false):', fs.existsSync(path.join(probDir, 'E1-2.py')),
    '| existing work preserved:', e1py.includes('MY_WORK_IN_PROGRESS'));

  // 6) language restriction metadata (9998 allows only C/C++)
  const ctx3 = await service.openProblem('9998');
  console.log('PROBLEM 9998 allowedLanguages:', ctx3 && JSON.stringify(ctx3.allowedLanguages), '| locked?', ctx3 && ctx3.allowedLanguages && ctx3.allowedLanguages.length === 1);

  // 7) language switch from panel -> creates a fresh file (E1.cpp), empty content
  const sw = await service.changeLanguageAndCreateFile(ctx, 'C++');
  const cppPath = path.join(probDir, 'E1.cpp');
  console.log('LANG SWITCH:', JSON.stringify({ ok: sw.ok, fileName: sw.fileName, lang: sw.language }),
    '| E1.cpp exists:', fs.existsSync(cppPath),
    '| content length:', fs.existsSync(cppPath) ? fs.readFileSync(cppPath, 'utf8').length : -1, '(expected 0)');

  // 8) HQ-4-9: C-only and code embedded in description -> C-locked + prefilled code
  const hq = await service.openProblem('HQ-4-9');
  const hqDir = path.join(baseDir, fs.readdirSync(baseDir).find((d) => d.startsWith('HQ-4-9')) || '');
  const hqFile = hq && hq.solutionFile;
  const hqPath = hqDir && hqFile ? path.join(hqDir, hqFile) : '';
  const hqContent = hqPath && fs.existsSync(hqPath) ? fs.readFileSync(hqPath, 'utf8') : '';
  console.log('HQ-4-9:', JSON.stringify({ allowed: hq && hq.allowedLanguages, locked: hq && hq.allowedLanguages && hq.allowedLanguages.length === 1, file: hqFile }),
    '| prefilledCode?', /int\s+main/.test(hqContent), '| contentLen:', hqContent.length);
  const hqSwitch = await service.changeLanguageAndCreateFile(hq, 'C++');
  console.log('HQ-4-9 switch->C++ blocked?', !hqSwitch.ok, '| msg:', hqSwitch.message);

  // 8b) active-file detection: identify problem + language, forbidden detection, stray file
  activeEditor = { document: { uri: fileUri(path.join(probDir, 'E1.cpp')) } };
  const ai1 = await service.resolveActiveContext();
  console.log('ACTIVE E1.cpp ->', JSON.stringify({ lang: ai1 && ai1.language, allowed: ai1 && ai1.allowed }));
  const ai1Init = ai1 ? await service.getInitialState(ai1.ctx) : undefined;
  console.log('   panel shows language:', ai1Init && ai1Init.language, '| file:', ai1Init && ai1Init.fileName);

  const d9998 = fs.readdirSync(baseDir).find((d) => d.startsWith('9998'));
  const p9998 = path.join(baseDir, d9998, '9998.py');
  fs.writeFileSync(p9998, 'print(1)\n');
  activeEditor = { document: { uri: fileUri(p9998) } };
  const ai2 = await service.resolveActiveContext();
  console.log('ACTIVE 9998.py ->', JSON.stringify({ lang: ai2 && ai2.language, allowed: ai2 && ai2.allowed, allowedList: ai2 && ai2.ctx.allowedLanguages }));
  const subBlocked = ai2 ? await service.submit(ai2.ctx, () => {}) : { error: 'n/a' };
  console.log('   submit with forbidden language blocked?', !!subBlocked.error, '| msg:', subBlocked.error);

  const stray = path.join(probDir, 'notes.txt');
  fs.writeFileSync(stray, 'x');
  activeEditor = { document: { uri: fileUri(stray) } };
  const ai3 = await service.resolveActiveContext();
  console.log('ACTIVE notes.txt -> recognized (should be false):', !!ai3);

  // 9) Temp workspace when no folder is open (random UUID under OS temp, cleaned on deactivate)
  vscode.workspace.workspaceFolders = undefined;
  const service2 = new NuaaOjService(auth, output, context, context.extensionUri, () => {});
  const tctx = await service2.openProblem('E1');
  const tempRoot = getTempRootPath();
  console.log('TEMP ROOT:', tempRoot, '| exists:', tempRoot ? fs.existsSync(tempRoot) : false, '| file:', tctx && tctx.solutionFile,
    '| underTemp?', !!tempRoot && fs.existsSync(tempRoot));
  await cleanupTempRoot();
  console.log('TEMP cleaned:', tempRoot ? !fs.existsSync(tempRoot) : true);

  fs.rmSync(work, { recursive: true, force: true });
  console.log('\nE2E DONE');
})().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
