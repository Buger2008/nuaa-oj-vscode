// Load the compiled extension with a mocked `vscode` module and run activate().
const Module = require('module');
const path = require('path');

class EventEmitter { constructor(){ this.event = () => ({ dispose(){} }); } fire(){} dispose(){} }
class TreeItem { constructor(label, state){ this.label = label; this.collapsibleState = state; } }
class ThemeIcon { constructor(id, color){ this.id = id; this.color = color; } }

const Uri = {
  parse: (s) => ({ scheme: 'https', fsPath: s, path: s, toString: () => s }),
  joinPath: (base, ...parts) => {
    const basePath = typeof base === 'string' ? base : base.fsPath || base.path || '';
    const p = [basePath, ...parts].join('/');
    return { scheme: 'file', fsPath: p, path: p, toString: () => p };
  },
  file: (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => p }),
};

const disposables = [];
const fakeConfig = { get: (k, d) => d, update: async () => {} };

const vscode = {
  EventEmitter,
  TreeItem,
  ThemeIcon,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
  ProgressLocation: { Notification: 15, Window: 10, SourceControl: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  Uri,
  window: {
    createOutputChannel: () => ({ appendLine(){}, append(){}, show(){}, dispose(){} }),
    createStatusBarItem: () => ({ show(){}, hide(){}, dispose(){}, text:'', tooltip:'', command:'' }),
    registerTreeDataProvider: () => ({ dispose(){} }),
    onDidChangeActiveTextEditor: () => ({ dispose(){} }),
    onDidChangeVisibleTextEditors: () => ({ dispose(){} }),
    visibleTextEditors: [],
    showInputBox: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showTextDocument: async () => ({}),
    createWebviewPanel: () => ({ webview: { html:'', cspSource:'', onDidReceiveMessage(){}, postMessage(){} }, onDidDispose(){}, reveal(){}, dispose(){}, title:'' }),
    withProgress: async (_o, fn) => fn(),
    setStatusBarMessage: () => ({ dispose(){} }),
    activeTextEditor: undefined,
  },
  workspace: {
    getConfiguration: () => fakeConfig,
    get workspaceFolders() { return undefined; },
    fs: { stat: async () => ({ type: 1 }), readFile: async () => Buffer.from('{}'), writeFile: async () => {}, createDirectory: async () => {}, readDirectory: async () => [] },
    openTextDocument: async () => ({ getText: () => '' }),
    onDidChangeActiveTextEditor: () => ({ dispose(){} }),
    onDidCloseTextDocument: () => ({ dispose(){} }),
    onDidDeleteFiles: () => ({ dispose(){} }),
    onDidRenameFiles: () => ({ dispose(){} }),
  },
  commands: {
    registerCommand: (id, fn) => { disposables.push({ id, fn }); return { dispose(){} }; },
    executeCommand: async () => undefined,
  },
  env: { clipboard: { readText: async () => '', writeText: () => {} }, openExternal: () => {} },
  l10n: { t: (s) => s },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscode;
  return origLoad.apply(this, arguments);
};

(async () => {
  const ext = require(path.join(__dirname, '..', 'out', 'extension.js'));
  if (typeof ext.activate !== 'function') throw new Error('activate not exported');

  const memento = { get: () => undefined, update: async () => {} };
  const context = {
    subscriptions: [],
    extensionUri: Uri.file(path.join(__dirname, '..')),
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
    globalState: memento,
    workspaceState: memento,
  };
  await ext.activate(context);
  console.log('ACTIVATE OK. registered commands:', disposables.filter(d => d.id).map(d => d.id).join(', '));
  console.log('subscriptions:', context.subscriptions.length);
  if (typeof ext.deactivate === 'function') ext.deactivate();
  console.log('LOAD TEST PASSED');
})().catch((e) => { console.error('LOAD TEST FAILED:', e); process.exit(1); });
