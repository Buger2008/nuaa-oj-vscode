const Module = require('module');
const orig = Module._load;
const Uri = { joinPath: (base, ...parts) => ({ fsPath: [typeof base === 'string' ? base : (base && base.fsPath) || '', ...parts].join('/') }) };
Module._load = function (r) { if (r === 'vscode') return { Uri }; return orig.apply(this, arguments); };
const { renderProblemHtml } = require('../out/statement.js');

const web = { cspSource: 'vscode-resource:', asWebviewUri: (u) => ({ toString: () => 'vscode-resource:' + (u && u.fsPath) }) };
const extUri = { fsPath: '/ext' };

const hqDetail = { problem: { problemId: 'HQ-4-9', title: '改错题', timeLimit: 1000, memoryLimit: 256, difficulty: 1, description: '<p>x</p>' }, tags: [] };
const hqCtx = { displayId: 'HQ-4-9', title: '改错题', timeLimit: 1000, memoryLimit: 256, isFileIO: false, samples: [{ input: 'a', output: 'b' }], allowedLanguages: ['C'], url: 'u' };
const hqHtml = renderProblemHtml(web, hqDetail, hqCtx, { language: 'C', fileName: 'HQ-4-9.c', loggedIn: true, baseUrl: 'b', languageLocked: true, allowedLanguages: ['C'] }, extUri);
console.log('HQ has <select id="langSelect">:', hqHtml.includes('<select id="langSelect"'));
console.log('HQ option C:', hqHtml.includes('>C</option>'));
console.log('HQ disabled(locked):', /langSelect[^>]*disabled/.test(hqHtml));
console.log('has katex css link:', hqHtml.includes('katex.min.css'));
console.log('has markdown-it script:', hqHtml.includes('markdown-it.min.js'));

const e1Detail = { problem: { problemId: 'E1', title: 'E1', timeLimit: 1, memoryLimit: 1 }, tags: [] };
const e1Ctx = { displayId: 'E1', title: 'E1', timeLimit: 1, memoryLimit: 1, isFileIO: false, samples: [], allowedLanguages: ['C', 'C++', 'Java'], url: 'u' };
const e1Html = renderProblemHtml(web, e1Detail, e1Ctx, { language: 'C++', fileName: 'E1.cpp', loggedIn: true, baseUrl: 'b', languageLocked: false, allowedLanguages: ['C', 'C++', 'Java'] }, extUri);
console.log('E1 options count:', (e1Html.match(/<option/g) || []).length, '| not disabled:', !/langSelect[^>]*disabled/.test(e1Html));
console.log('E1 selected C++?:', /value="C\+\+"\s+selected/.test(e1Html));

const fDetail = { problem: { problemId: '9998', title: 't', timeLimit: 1, memoryLimit: 1 }, tags: [] };
const fCtx = { displayId: '9998', title: 't', timeLimit: 1, memoryLimit: 1, isFileIO: false, samples: [], allowedLanguages: ['C', 'C++'], url: 'u' };
const fHtml = renderProblemHtml(web, fDetail, fCtx, { language: 'C', fileName: '9998.py', loggedIn: true, baseUrl: 'b', languageLocked: false, allowedLanguages: ['C', 'C++'], canSubmit: false, forbiddenLanguage: 'Python3' }, extUri);
console.log('FORBIDDEN submit disabled:', /id="btn-submit"[^>]*disabled/.test(fHtml));
console.log('FORBIDDEN banner:', fHtml.includes('语言不被允许'));
