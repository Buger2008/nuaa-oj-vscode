const Module = require('module');
const orig = Module._load;
class EventEmitter { constructor(){ this.event = () => ({ dispose(){} }); } fire(){} dispose(){} }
const Uri = { joinPath: (b, ...p) => ({ fsPath: [typeof b === 'string' ? b : (b && b.fsPath) || '', ...p].join('/') }) };
Module._load = function (r) {
  if (r === 'vscode') return { EventEmitter, Uri, ViewColumn: { Beside: -2 }, workspace: { getConfiguration: () => ({ get: (k, d) => d }) }, window: {} };
  return orig.apply(this, arguments);
};

const { ProblemPanel } = require('../out/problemPanel.js');

let disposedCb;
const fakePanel = {
  title: '',
  webview: {
    html: '',
    onDidReceiveMessage() {},
    postMessage() { throw new Error('Webview is disposed'); },
  },
  onDidDispose(cb) { disposedCb = cb; },
  reveal() {},
  dispose() { if (disposedCb) disposedCb(); },
};
const host = { getInitialState: async () => ({ language: 'C', fileName: 'x.c', loggedIn: true, baseUrl: 'b' }) };
const ctx = { kind: 'problem', displayId: 'X', title: 'T', timeLimit: 1, memoryLimit: 1, isFileIO: false, samples: [], url: 'u' };

(async () => {
  const p = new ProblemPanel(fakePanel, { problem: {}, tags: [] }, ctx, host, Uri.joinPath('/ext'));
  console.log('isDisposed before:', p.isDisposed);
  p.dispose();
  console.log('isDisposed after:', p.isDisposed);
  try {
    p.postStatus('hello');
    p.postError('err');
    p.postTestResult({ ok: true, cases: [] });
    p.postSubmitResult({ status: {} });
    await p.render();
    console.log('POST-AFTER-DISPOSE: no throw OK');
  } catch (e) {
    console.log('POST-AFTER-DISPOSE THREW:', e.message);
    process.exit(1);
  }
})();
