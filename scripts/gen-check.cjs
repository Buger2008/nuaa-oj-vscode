const Module = require('module');
const orig = Module._load;
const Uri = { joinPath: (base, ...parts) => ({ fsPath: [typeof base === 'string' ? base : (base && base.fsPath) || '', ...parts].join('/') }) };
Module._load = function (r) { if (r === 'vscode') return { Uri }; return orig.apply(this, arguments); };
const { renderProblemHtml } = require('../out/statement.js');
const { OjApi } = require('../out/api.js');

const web = { cspSource: 'https://file+.vscode-resource.vscode-cdn.net', asWebviewUri: (u) => ({ toString: () => 'https://file+.vscode-resource.vscode-cdn.net' + (u && u.fsPath) }) };
const extUri = { fsPath: '/ext' };

(async () => {
  const api = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn' });
  const { token } = await api.login('162610126', 'oj162610126oj');
  const api2 = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn', getToken: () => token });
  const d = await api2.getProblemDetail('NUAA2023_J');
  const ctx = { displayId: 'NUAA2023_J', title: d.problem.title, timeLimit: d.problem.timeLimit, memoryLimit: d.problem.memoryLimit, isFileIO: false, samples: [{ input: 'a', output: 'b' }], allowedLanguages: d.languages, url: 'u' };
  const html = renderProblemHtml(web, d, ctx, { language: 'C++', fileName: 'NUAA2023_J.cpp', loggedIn: true, baseUrl: 'https://oj.nuaa.edu.cn', languageLocked: false, allowedLanguages: d.languages }, extUri);

  console.log('HTML length:', html.length);
  console.log('has sec-description:', html.includes('id="sec-description"'));
  console.log('has katex.min.css:', html.includes('katex.min.css'));
  console.log('has markdown-it.min.js:', html.includes('markdown-it.min.js'));
  console.log('script srcs:', [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]));
  console.log('has const RAW:', html.includes('__RAW__'));

  const scripts = [...html.matchAll(/<script nonce="[^"]*">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  console.log('nonce scripts:', scripts.length);
  scripts.forEach((code, i) => {
    try {
      new Function(code);
      console.log(`  nonce script #${i} SYNTAX OK (len ${code.length})`);
    } catch (e) {
      console.log(`  nonce script #${i} SYNTAX ERROR: ${e.message}`);
    }
  });
})();
