import * as vscode from 'vscode';
import { ProblemDetail } from './types';
import { ProblemContext } from './context';

function esc(s: string | undefined | null): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface InitialState {
  language: string;
  fileName: string;
  loggedIn: boolean;
  user?: string;
  baseUrl: string;
  languageLocked?: boolean;
  allowedLanguages?: string[];
  /** When false, the submit button is disabled (e.g. the active file's language is forbidden). */
  canSubmit?: boolean;
  /** If set, shows a warning that this language is forbidden for the problem. */
  forbiddenLanguage?: string;
}

export function renderProblemHtml(
  webview: vscode.Webview,
  detail: ProblemDetail,
  ctx: ProblemContext,
  init: InitialState,
  extensionUri: vscode.Uri,
): string {
  const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  const p = detail.problem;
  const tags = (detail.tags || []).map((t) => `<span class="tag">${esc(t.name)}</span>`).join('');

  // Local vendor assets for Markdown + KaTeX (no network / CDN needed).
  const katexCss = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'vendor', 'katex.min.css'));
  const katexJs = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'vendor', 'katex.min.js'));
  const mdJs = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'vendor', 'markdown-it.min.js'));
  const renderJs = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'resources', 'vendor', 'statement-render.js'));

  const langs = init.allowedLanguages && init.allowedLanguages.length ? init.allowedLanguages : [init.language];
  const langOptions = langs
    .map((l) => `<option value="${esc(l)}" ${l === init.language ? 'selected' : ''}>${esc(l)}</option>`)
    .join('');

  const samplesHtml = ctx.samples.length
    ? ctx.samples
        .map(
          (s, i) => `
        <div class="sample">
          <div class="sample-head">
            <span class="sample-title">样例 ${i + 1}</span>
            <button class="mini" data-copy-sample="${i}">复制输入</button>
          </div>
          <div class="sample-cols">
            <div><div class="sample-label">输入</div><pre class="io">${esc(s.input)}</pre></div>
            <div><div class="sample-label">输出</div><pre class="io">${esc(s.output)}</pre></div>
          </div>
        </div>`,
        )
        .join('')
    : '<p class="muted">该题没有可用的样例数据。</p>';

  const forbiddenBanner = init.forbiddenLanguage
    ? `<div class="banner danger">
         <strong>语言不被允许：</strong>当前文件的语言「${esc(init.forbiddenLanguage)}」在本题中被禁止使用。
         ${init.allowedLanguages && init.allowedLanguages.length ? '本题仅允许：' + init.allowedLanguages.map(esc).join('、') + '。' : ''}
         请在上方切换语言（会新建/打开对应语言的代码文件），或改用允许的扩展名。提交按钮已禁用。
       </div>`
    : '';

  const canSubmit = init.canSubmit !== false;
  const fileIoBanner = ctx.isFileIO
    ? `<div class="banner warn">
         <strong>该题为文件 IO 题：</strong>程序需从 <code>${esc(ctx.ioReadFileName || '输入文件')}</code>
         读取、写入 <code>${esc(ctx.ioWriteFileName || '输出文件')}</code>。
         文件 IO 题：有样例时会把样例内容写入输入文件进行测试（本地/云端均可）；无样例（如二进制题）点“测试”会先弹确认，确认后按 <b>提交评测</b> 处理（云端用官方文件）。
       </div>`
    : '';

  const sectionDefs: Array<[string, string, string | undefined]> = [
    ['description', '题目描述', p.description],
    ['input', '输入格式', p.input],
    ['output', '输出格式', p.output],
    ['hint', '提示', p.hint],
  ];
  const bodyHtml = sectionDefs
    .filter(([, , v]) => v && v.trim())
    .map(([key, title]) => `<section class="md"><h3>${title}</h3><div class="content" id="sec-${key}"></div></section>`)
    .join('');
  // Raw Markdown source; the client script renders it with markdown-it + KaTeX.
  const rawJson = JSON.stringify({
    description: p.description || '',
    input: p.input || '',
    output: p.output || '',
    hint: p.hint || '',
  }).replace(/</g, '\\u003c');

  const initJson = JSON.stringify({ ...init, isFileIO: ctx.isFileIO, sampleCount: ctx.samples.length }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource};" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(p.title)}</title>
<link rel="stylesheet" href="${katexCss}" />
<script src="${katexJs}"></script>
<script src="${mdJs}"></script>
<script nonce="${nonce}">window.__RAW__ = ${rawJson};</script>
<script src="${renderJs}" defer></script>
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px; line-height: 1.55;
         color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0 22px 60px; }
  header { position: sticky; top: 0; z-index: 5; padding: 14px 0 10px; margin-bottom: 6px;
           background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); }
  h1 { font-size: 19px; margin: 0 0 8px; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .tag { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
         border-radius: 10px; padding: 1px 8px; font-size: 11px; }
  select.lang { font-family: inherit; font-size: 12px; padding: 2px 6px; border-radius: 4px;
         background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
         border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border)); vertical-align: middle; }
  select.lang:disabled { opacity: .8; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
  button { font-family: inherit; font-size: 13px; border: 1px solid var(--vscode-button-border, transparent);
           background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           padding: 6px 14px; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.mini { padding: 2px 8px; font-size: 11px; }
  section.md { margin: 18px 0; }
  section.md h3 { font-size: 14px; margin: 0 0 8px; padding-left: 8px; border-left: 3px solid var(--vscode-focusBorder); }
  .content :is(p,ul,ol) { margin: 6px 0; }
  .content img { max-width: 100%; }
  .content code { background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15)); padding: 1px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); }
  .content pre code { background: none; padding: 0; }
  .content blockquote { border-left: 3px solid var(--vscode-panel-border); margin: 8px 0; padding-left: 10px; color: var(--vscode-descriptionForeground); }
  .content table { border-collapse: collapse; }
  .content th, .content td { border: 1px solid var(--vscode-panel-border); padding: 4px 8px; }
  .katex-display { overflow-x: auto; overflow-y: hidden; }
  .content pre, pre.io { background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
        padding: 8px 10px; border-radius: 4px; overflow-x: auto; white-space: pre; font-family: var(--vscode-editor-font-family, monospace); font-size: 12.5px; }
  .sample { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px 12px; margin: 12px 0; }
  .sample-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .sample-title { font-weight: 600; }
  .sample-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .sample-label { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 2px; }
  .muted { color: var(--vscode-descriptionForeground); }
  .banner { padding: 10px 14px; border-radius: 6px; margin: 12px 0; }
  .banner.warn { background: rgba(230,162,60,.15); border: 1px solid rgba(230,162,60,.6); }
  .banner.danger { background: rgba(245,108,108,.15); border: 1px solid rgba(245,108,108,.7); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  #customInput { width: 100%; box-sizing: border-box; min-height: 96px; resize: vertical; font-family: var(--vscode-editor-font-family, monospace);
         font-size: 12.5px; padding: 8px 10px; border-radius: 5px; background: var(--vscode-input-background);
         color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }
  code { background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15)); padding: 1px 5px; border-radius: 3px; }
  #results { margin-top: 26px; }
  .pill { display: inline-block; padding: 1px 9px; border-radius: 10px; font-weight: 700; font-size: 12px; color: #fff; }
  .case { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px 12px; margin: 8px 0; }
  .case-head { display: flex; gap: 10px; align-items: center; }
  .diff { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
  .diff .block-label { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .progress { color: var(--vscode-descriptionForeground); font-style: italic; }
  .big { font-size: 15px; }
  .summary { margin: 10px 0; padding: 10px 14px; border-radius: 6px; border: 1px solid var(--vscode-panel-border); }
</style>
</head>
<body>
<header>
  <h1>${esc(p.title)}</h1>
  <div class="meta">
    <span>编号 <b>${esc(p.problemId)}</b></span>
    <span>时间限制 ${p.timeLimit} ms</span>
    <span>内存限制 ${p.memoryLimit} MB</span>
    <span>难度 ${p.difficulty ?? '-'}</span>
    ${p.source ? `<span>来源 ${esc(p.source)}</span>` : ''}
    <span class="muted">语言 <select id="langSelect" class="lang" ${init.languageLocked ? 'disabled title="该题仅允许一种语言，已锁定"' : ''}>${langOptions}</select>${init.languageLocked ? ' 🔒' : ''} · 文件 <code id="fileLabel">${esc(init.fileName)}</code></span>
  </div>
  <div class="meta">${tags}</div>
</header>

<div class="toolbar">
  <button id="btn-test">▶ 用样例测试</button>
  <button id="btn-cloudtest" title="在 OJ 服务器上用样例运行当前代码（在线调试，每例约需 5 秒）">☁ 云端样例测试</button>
  <button id="btn-submit" ${canSubmit ? '' : 'disabled title="当前文件语言被本题禁止，无法提交"'}>☁ 提交代码</button>
  <button class="secondary" id="btn-lastac" title="获取你最近一次通过的代码并覆盖当前文件">⤓ 最近AC代码</button>
  <button class="secondary" id="btn-mysub" title="在新标签页查看我的提交">我的提交</button>
  <button class="secondary" id="btn-allsub" title="在新标签页查看全部提交">全部提交</button>
  <button class="secondary" id="btn-mytest" title="在新标签页查看本次会话的自测记录">我的自测</button>
  <button class="secondary" id="btn-ai" title="打开 NUAA AI 助教（针对性指导）">🤖 AI 助手</button>
  <button class="secondary" id="btn-browser">在浏览器打开</button>
  <button class="secondary" id="btn-refresh">刷新题面</button>
</div>
${forbiddenBanner}
${fileIoBanner}
${bodyHtml}
<section class="md">
  <h3>样例</h3>
  ${samplesHtml}
</section>

<section class="md">
  <h3>云端自定义测试</h3>
  <p class="muted" style="margin:0 0 6px">输入你自己的测试数据（≤1000 字符），点下面按钮在 OJ 服务器上运行当前代码。</p>
  <textarea id="customInput" placeholder="在此输入自定义输入数据…"></textarea>
  <div style="margin-top:8px"><button id="btn-cloudcustom">☁ 云端运行自定义输入</button></div>
</section>

<div id="results">
  <div class="muted">点击上方按钮在此查看测试 / 评测结果。</div>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const INIT = ${initJson};
  const $ = (id) => document.getElementById(id);

  window.addEventListener('message', (e) => {
    const msg = e.data;
    switch (msg.type) {
      case 'status': showStatus(msg.text); break;
      case 'testResult': renderTest(msg.result); break;
      case 'submitResult': renderSubmit(msg.result); break;
      case 'error': showError(msg.text); break;
      case 'meta': break;
      case 'languageChanged':
        if (msg.language && $('langSelect')) $('langSelect').value = msg.language;
        if (msg.fileName) $('fileLabel').textContent = msg.fileName;
        showStatus('已切换语言为 ' + (msg.language || '') + '，新建文件 ' + (msg.fileName || '') + '（提交将使用该文件）');
        break;
    }
  });

  $('btn-test').addEventListener('click', () => vscode.postMessage({ type: 'test' }));
  $('btn-cloudtest').addEventListener('click', () => vscode.postMessage({ type: 'cloudTest' }));
  $('btn-cloudcustom').addEventListener('click', () => vscode.postMessage({ type: 'cloudTestCustom', input: $('customInput').value }));
  $('btn-submit').addEventListener('click', () => vscode.postMessage({ type: 'submit' }));
  $('btn-lastac').addEventListener('click', () => vscode.postMessage({ type: 'loadAc' }));
  $('btn-mysub').addEventListener('click', () => vscode.postMessage({ type: 'openRecords', tab: 'my' }));
  $('btn-allsub').addEventListener('click', () => vscode.postMessage({ type: 'openRecords', tab: 'all' }));
  $('btn-mytest').addEventListener('click', () => vscode.postMessage({ type: 'openRecords', tab: 'test' }));
  $('btn-ai').addEventListener('click', () => vscode.postMessage({ type: 'openAssistant' }));
  $('btn-browser').addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
  $('btn-refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  document.querySelectorAll('[data-copy-sample]').forEach((b) => {
    b.addEventListener('click', () => vscode.postMessage({ type: 'copySample', index: Number(b.getAttribute('data-copy-sample')) }));
  });
  const langSel = $('langSelect');
  if (langSel) langSel.addEventListener('change', () => vscode.postMessage({ type: 'changeLanguage', language: langSel.value }));

  function pill(status) {
    const map = { AC:'#67c23a', WA:'#f56c6c', RE:'#f56c6c', TLE:'#f56c6c', CE:'#e6a23c', OK:'#409eff' };
    return '<span class="pill" style="background:' + (map[status]||'#9e9e9e') + '">' + status + '</span>';
  }
  function pre(s) { return '<pre class="io">' + escapeHtml(s || '') + '</pre>'; }
  function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  function showStatus(text) {
    $('results').innerHTML = '<div class="progress">' + escapeHtml(text) + '</div>';
  }
  function showError(text) {
    $('results').innerHTML = '<div class="summary" style="border-color:#f56c6c"><b>出错：</b> ' + escapeHtml(text) + '</div>';
  }

  function renderTest(r) {
    let html = '<h3 style="margin:14px 0 8px">' + (r.cloud ? '云端样例测试' : '本地样例测试') + '</h3>';
    if (r.skipped) { html += '<div class="summary">' + escapeHtml(r.skipped) + '</div>'; $('results').innerHTML = html; return; }
    if (r.compileError) {
      html += '<div class="summary" style="border-color:#e6a23c"><b>编译错误：</b></div>' + pre(r.compileError);
      $('results').innerHTML = html; return;
    }
    const hasOk = r.cases.some((c) => c.status === 'OK');
    const passed = r.cases.filter((c) => c.status === 'AC' || c.status === 'OK').length;
    html += '<div class="summary big">' + (hasOk ? '☁ 运行完成 ' : r.ok ? '✅ 全部通过 ' : '❌ ') + passed + ' / ' + r.cases.length +
            (hasOk ? ' 用例' : ' 通过') + ' · 总耗时 ' + r.totalTimeMs + ' ms</div>';
    for (const c of r.cases) {
      const okDone = c.status === 'AC' || c.status === 'OK';
      html += '<div class="case"><div class="case-head">' + pill(c.status) +
              ' <b>' + (hasOk ? '输入' : '样例') + ' ' + c.index + '</b> <span class="muted">' + c.timeMs + ' ms</span></div>';
      if (c.status === 'OK') {
        html += '<div class="block-label" style="margin-top:6px">输入</div>' + pre(c.input) +
                '<div class="block-label" style="margin-top:6px">输出</div>' + pre(c.actual);
      } else if (!okDone) {
        html += '<div class="diff"><div><div class="block-label">期望输出</div>' + pre(c.expected) +
                '</div><div><div class="block-label">实际输出</div>' + pre(c.actual) + '</div></div>';
        if (c.stderr) html += '<div class="block-label" style="margin-top:6px">stderr</div>' + pre(c.stderr);
      } else {
        html += '<div class="block-label" style="margin-top:6px">输出</div>' + pre(c.actual);
      }
      html += '</div>';
    }
    $('results').innerHTML = html;
  }

  function renderSubmit(r) {
    let html = '<h3 style="margin:14px 0 8px">云端评测结果</h3>';
    if (r.phase === 'progress') { showStatus(r.text); return; }
    if (r.error) { html += '<div class="summary" style="border-color:#f56c6c"><b>提交失败：</b> ' + escapeHtml(r.error) + '</div>'; $('results').innerHTML = html; return; }
    const st = r.status || {};
    html += '<div class="summary big"><span class="pill" style="background:' + (st.color||'#9e9e9e') + '">' +
            escapeHtml(st.short || '?') + '</span> ' + escapeHtml(st.name || '') +
            (r.submitId ? ' · 提交 #' + r.submitId : '') + '</div>';
    if (r.time != null || r.memory != null || r.score != null) {
      html += '<div class="meta" style="margin:8px 0">' +
              (r.time != null ? '耗时 ' + r.time + ' ms · ' : '') +
              (r.memory != null ? '内存 ' + r.memory + ' KB · ' : '') +
              (r.score != null ? '得分 ' + r.score : '') + '</div>';
    }
    if (r.errorMessage && !/does not support viewing/i.test(r.errorMessage)) { html += '<div class="block-label" style="margin-top:6px">评测信息</div>' + pre(r.errorMessage); }
    if (Array.isArray(r.cases) && r.cases.length) {
      html += '<div class="block-label" style="margin-top:10px">测试点</div>';
      for (const c of r.cases) {
        html += '<div class="case"><div class="case-head">' + pill(c.statusText || '?') +
                ' <b>#' + (c.seq ?? '') + '</b> <span class="muted">' + (c.time ?? '-') + ' ms · ' +
                (c.memory ?? '-') + ' KB · 得分 ' + (c.score ?? '-') + '</span></div></div>';
      }
    }
    html += '<div class="meta" style="margin-top:12px"><a href="' + INIT.baseUrl + '/submission-detail/' + (r.submitId||'') + '">在 OJ 查看提交详情</a></div>';
    $('results').innerHTML = html;
  }

  // Statement sections (Markdown + LaTeX) are rendered by resources/vendor/statement-render.js.

  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
