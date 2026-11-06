import * as vscode from 'vscode';
import { ProblemContext } from './context';
import { statusMeta } from './status';

export interface RecordsHost {
  fetchSubmissions(ctx: ProblemContext, onlyMine: boolean): Promise<{ records: any[]; total: number }>;
  getTestHistory(ctx: ProblemContext): Promise<any[]>;
  getSubmissionDetail(submitId: number): Promise<any>;
  getCaseResults(submitId: number): Promise<any[]>;
  applySubmission(ctx: ProblemContext, submitId: number): Promise<void>;
  submissionUrl(submitId: number): string;
  openExternal(url: string): void;
  copyText(text: string): void;
}

function esc(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function fmtTime(s: any): string {
  if (!s) return '';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return String(s);
  }
}

export class RecordsPanel {
  private static map = new Map<string, RecordsPanel>();
  private tab: 'my' | 'all' | 'test';
  private data: any[] = [];
  private total = 0;
  private error = '';
  private loading = false;

  private detailId: number | null = null;
  private detailOnly = false;
  private detail: any = null;
  private detailCases: any[] = [];
  private detailLoading = false;
  private detailError = '';

  private disposables: vscode.Disposable[] = [];

  static key(ctx: ProblemContext): string {
    return `${ctx.kind}:${ctx.tid ?? 0}:${ctx.displayId}`;
  }

  static async show(ctx: ProblemContext, host: RecordsHost, extensionUri: vscode.Uri, tab: 'my' | 'all' | 'test'): Promise<void> {
    const key = RecordsPanel.key(ctx);
    const existing = RecordsPanel.map.get(key);
    if (existing) {
      existing.tab = tab;
      existing.ctx = ctx;
      existing.detailId = null;
      existing.detail = null;
      existing.panel.reveal(vscode.ViewColumn.Active, false);
      await existing.reload();
      return;
    }
    const panel = vscode.window.createWebviewPanel('nuaaOjRecords', `提交记录 · ${ctx.displayId}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const p = new RecordsPanel(panel, ctx, host, extensionUri, tab);
    RecordsPanel.map.set(key, p);
    panel.onDidDispose(() => {
      RecordsPanel.map.delete(key);
      while (p.disposables.length) {
        try { p.disposables.pop()?.dispose(); } catch { /* ignore */ }
      }
    });
    await p.reload();
  }

  /** Open just a single submission's detail (no problem context), reusing the detail view. */
  static async showDetail(host: RecordsHost, extensionUri: vscode.Uri, submitId: number): Promise<void> {
    const key = `submission:${submitId}`;
    const existing = RecordsPanel.map.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Active, false);
      existing.detailId = submitId;
      await existing.loadDetail(submitId);
      return;
    }
    const panel = vscode.window.createWebviewPanel('nuaaOjRecords', `提交详情 #${submitId}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const synth: any = { kind: 'problem', displayId: String(submitId), title: '', tid: 0, timeLimit: 1000, memoryLimit: 256, isFileIO: false, samples: [], allowedLanguages: [], url: '' };
    const p = new RecordsPanel(panel, synth, host, extensionUri, 'my');
    p.detailOnly = true;
    p.detailId = submitId;
    RecordsPanel.map.set(key, p);
    panel.onDidDispose(() => {
      RecordsPanel.map.delete(key);
      while (p.disposables.length) { try { p.disposables.pop()?.dispose(); } catch { /* ignore */ } }
    });
    await p.loadDetail(submitId);
  }

  private constructor(
    private panel: vscode.WebviewPanel,
    private ctx: ProblemContext,
    private host: RecordsHost,
    private extensionUri: vscode.Uri,
    tab: 'my' | 'all' | 'test',
  ) {
    this.tab = tab;
    panel.webview.onDidReceiveMessage(
      async (m) => {
        if (m?.type === 'ready') { if (this.detailOnly && this.detailId != null && !this.detail) await this.loadDetail(this.detailId); else if (!this.detailOnly && !this.data.length && !this.loading) await this.reload(); }
        else if (m?.type === 'tab') { this.tab = m.tab; this.detailId = null; this.detail = null; await this.reload(); }
        else if (m?.type === 'open') this.host.openExternal(String(m.url));
        else if (m?.type === 'refresh') { if (this.detailId != null) await this.loadDetail(this.detailId); else await this.reload(); }
        else if (m?.type === 'detail') await this.loadDetail(Number(m.submitId));
        else if (m?.type === 'back') { this.detailId = null; this.detail = null; this.render(); }
        else if (m?.type === 'copyCode') this.host.copyText(String(m.code ?? ''));
        else if (m?.type === 'apply') await this.host.applySubmission(this.ctx, Number(m.submitId));
      },
      null,
      this.disposables,
    );
  }

  private async reload(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.render();
    try {
      if (this.tab === 'test') {
        this.data = await this.host.getTestHistory(this.ctx);
        this.total = this.data.length;
      } else {
        const res = await this.host.fetchSubmissions(this.ctx, this.tab === 'my');
        this.data = res.records || [];
        this.total = res.total || this.data.length;
      }
    } catch (e: any) {
      this.error = e?.message ?? String(e);
      this.data = [];
    }
    this.loading = false;
    this.render();
  }

  private async loadDetail(submitId: number): Promise<void> {
    this.detailId = submitId;
    this.detail = null;
    this.detailCases = [];
    this.detailError = '';
    this.detailLoading = true;
    this.render();
    try {
      const [d, cases] = await Promise.all([
        this.host.getSubmissionDetail(submitId),
        this.host.getCaseResults(submitId).catch(() => []),
      ]);
      this.detail = d;
      this.detailCases = cases || [];
    } catch (e: any) {
      this.detailError = e?.message ?? String(e);
    }
    this.detailLoading = false;
    this.render();
  }

  private render(): void {
    const n = this.nonce();
    this.panel.webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>${this.css()}</style></head><body>
${this.detailId != null ? this.renderDetail() : this.renderList()}
<script nonce="${n}">
 const vscode = acquireVsCodeApi();
 document.querySelectorAll('[data-tab]').forEach((b)=>b.addEventListener('click',()=>vscode.postMessage({type:'tab',tab:b.getAttribute('data-tab')})));
 document.querySelectorAll('[data-refresh]').forEach((b)=>b.addEventListener('click',()=>vscode.postMessage({type:'refresh'})));
 document.querySelectorAll('tr.row').forEach((r)=>r.addEventListener('click',()=>vscode.postMessage({type:'open',url:r.getAttribute('data-url')})));
 document.querySelectorAll('a.runid').forEach((a)=>a.addEventListener('click',(e)=>{e.stopPropagation();vscode.postMessage({type:'detail',submitId:a.getAttribute('data-rid')});}));
 document.querySelectorAll('[data-back]').forEach((b)=>b.addEventListener('click',()=>vscode.postMessage({type:'back'})));
 document.querySelectorAll('[data-copy]').forEach((b)=>b.addEventListener('click',()=>vscode.postMessage({type:'copyCode',code:b.getAttribute('data-copy')})));
 document.querySelectorAll('[data-open]').forEach((b)=>b.addEventListener('click',()=>vscode.postMessage({type:'open',url:b.getAttribute('data-open')})));
 document.querySelectorAll('[data-apply]').forEach((b)=>b.addEventListener('click',()=>vscode.postMessage({type:'apply',submitId:b.getAttribute('data-apply')})));
</script></body></html>`;
  }

  private nonce(): string {
    return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  }

  private css(): string {
    return `
 body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:12px 18px;}
 h1{font-size:16px;margin:0 0 10px;}
 .tabs{display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:8px;flex-wrap:wrap;}
 .tab{font-family:inherit;font-size:13px;padding:5px 12px;border-radius:4px;border:1px solid transparent;background:transparent;color:var(--vscode-foreground);cursor:pointer;}
 .tab.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
 table{border-collapse:collapse;width:100%;font-size:12.5px;}
 th,td{border-bottom:1px solid var(--vscode-panel-border);padding:6px 8px;text-align:left;}
 th{position:sticky;top:0;background:var(--vscode-editor-background);}
 tr.row{cursor:pointer;} tr.row:hover{background:rgba(127,127,127,.12);}
 a.runid{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:underline;}
 .pill{display:inline-block;color:#fff;border-radius:10px;padding:0 8px;font-weight:700;font-size:11px;}
 .muted{color:var(--vscode-descriptionForeground);} .err{color:#f56c6c;}
 .detail{max-width:900px;}
 .time-big{font-size:26px;font-weight:700;margin:6px 0 10px;color:var(--vscode-textLink-foreground);}
 .kv{display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:13px;margin:10px 0;}
 .kv .k{color:var(--vscode-descriptionForeground);}
 pre.code{background:var(--vscode-textCodeBlock-background,rgba(127,127,127,.15));padding:10px;border-radius:6px;overflow:auto;font-family:var(--vscode-editor-font-family,monospace);font-size:12.5px;white-space:pre;}
 .actions{display:flex;gap:8px;margin:14px 0;}
 .actions button{font-family:inherit;font-size:13px;padding:6px 14px;border-radius:4px;cursor:pointer;border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
 .actions button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);}
 .cases{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;}
 .case{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px 10px;}
 .case-head{display:flex;gap:8px;align-items:center;margin-bottom:4px;}
 .case .cm{font-size:12.5px;} .case .pts{font-size:12px;color:var(--vscode-descriptionForeground);}`;
  }

  private renderList(): string {
    const tabBtn = (id: string, label: string) => `<button class="tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;
    let body = '';
    if (this.loading) body = '<p class="muted">加载中…</p>';
    else if (this.error) body = `<p class="err">加载失败：${esc(this.error)}</p>`;
    else if (!this.data.length) body = `<p class="muted">${this.tab === 'test' ? '本次会话还没有测试记录。' : '暂无提交记录。'}</p>`;
    else if (this.tab === 'test') {
      body =
        '<table><thead><tr><th>时间</th><th>类型</th><th>语言</th><th>结果</th></tr></thead><tbody>' +
        this.data
          .map((r) => {
            const ok = r.ok ? '<span class="pill" style="background:#67c23a">OK</span>' : '<span class="pill" style="background:#f56c6c">失败</span>';
            return `<tr><td>${esc(fmtTime(new Date(r.at).toISOString()))}</td><td>${esc(r.kind)}</td><td>${esc(r.language)}</td><td>${ok} ${r.passed}/${r.total}</td></tr>`;
          })
          .join('') +
        '</tbody></table>';
    } else {
      const showUser = this.tab === 'all';
      body =
        '<table><thead><tr><th>RUNID</th>' +
        (showUser ? '<th>用户</th>' : '') +
        '<th>状态</th><th>时间</th><th>内存</th><th>语言</th><th>得分</th><th>提交时间</th></tr></thead><tbody>' +
        this.data
          .map((r) => {
            const st = statusMeta(r.status);
            const url = this.host.submissionUrl(r.submitId);
            return (
              `<tr class="row" data-url="${esc(url)}">` +
              `<td><a class="runid" data-rid="${r.submitId}" title="点击查看详情（运行时间等）">#${r.submitId}</a></td>` +
              (showUser ? `<td>${esc(r.username || '')}</td>` : '') +
              `<td><span class="pill" style="background:${st.color}">${st.short}</span> ${esc(st.name)}</td>` +
              `<td>${r.time ?? '-'} ms</td><td>${r.memory ?? '-'} KB</td><td>${esc(r.language || '')}</td><td>${r.score ?? '-'}</td>` +
              `<td>${esc(fmtTime(r.submitTime))}</td></tr>`
            );
          })
          .join('') +
        '</tbody></table>';
    }
    return (
      `<h1>提交记录 · ${esc(this.ctx.displayId)} ${esc(this.ctx.title)} <span class="muted">（共 ${this.total} 条${this.tab === 'test' ? '，仅本次会话' : ''}）</span></h1>` +
      `<div class="tabs">${tabBtn('my', '我的提交')}${tabBtn('all', '全部提交')}${tabBtn('test', '我的自测')}<button class="tab" data-refresh="1">刷新</button></div>` +
      body
    );
  }

  private renderDetail(): string {
    const sid = this.detailId;
    let body = '';
    if (this.detailLoading) body = '<p class="muted">加载中…</p>';
    else if (this.detailError) body = `<p class="err">加载失败：${esc(this.detailError)}</p>`;
    else if (this.detail) {
      const sub = this.detail.submission || this.detail;
      const url = this.host.submissionUrl(Number(sub.submitId ?? sid));
      const st = statusMeta(sub.status);
      const canView = this.detail.canViewCode;
      const code = sub.code && String(sub.code).length ? String(sub.code) : '';
      const hidden = code && code.length < 400 && /hidden|super administrator|已被隐藏|隐藏/.test(code);
      let codeHtml = '';
      if (canView && code && !hidden) {
        codeHtml =
          `<div class="actions"><button data-copy="${esc(code)}">复制代码</button>${this.detailOnly ? '' : `<button class="secondary" data-apply="${sub.submitId ?? sid}">覆盖到源文件</button>`}</div>` +
          `<pre class="code">${esc(code)}</pre>`;
      } else if (hidden) {
        codeHtml = '<p class="muted">该提交的代码被网站设置为隐藏，无法查看。</p>';
      } else if (!canView) {
        codeHtml = '<p class="muted">非本人提交（或网站未开放），无法查看代码。</p>';
      }
      let casesHtml = '';
      if (this.detailCases.length) {
        casesHtml =
          '<h3 style="font-size:14px;margin:16px 0 8px">测试点</h3><div class="cases">' +
          this.detailCases
            .map((c, i) => {
              const cs = statusMeta(c.status);
              return (
                `<div class="case"><div class="case-head"><span class="pill" style="background:${cs.color}">${cs.short}</span> <b>Test #${c.seq ?? i + 1}</b></div>` +
                `<div class="cm">${c.time ?? '-'}ms / ${c.memory ?? '-'} KB</div>` +
                `<div class="pts">${c.score ?? '-'} pts</div></div>`
              );
            })
            .join('') +
          '</div>';
      }
      body =
        `<div class="detail">` +
        `<div><span class="pill" style="background:${st.color}">${st.short}</span> <b>${esc(st.name)}</b></div>` +
        `<div class="time-big">⏱ 运行时间：${sub.time ?? '-'} ms</div>` +
        `<div class="kv">` +
        `<div class="k">RUNID</div><div>#${sub.submitId ?? sid}</div>` +
        `<div class="k">内存</div><div>${sub.memory ?? '-'} KB</div>` +
        `<div class="k">语言</div><div>${esc(sub.language || '')}</div>` +
        `<div class="k">得分</div><div>${sub.score ?? '-'}</div>` +
        `<div class="k">用户</div><div>${esc(sub.username || '')}</div>` +
        `<div class="k">提交时间</div><div>${esc(fmtTime(sub.submitTime))}</div>` +
        (sub.errorMessage && sub.status !== 0 ? `<div class="k">信息</div><div>${esc(sub.errorMessage)}</div>` : '') +
        `</div>` +
        casesHtml +
        codeHtml +
        (this.detailOnly
          ? `<div class="actions"></div>`
          : `<div class="actions"><button data-back="1" class="secondary">← 返回列表</button><button class="secondary" data-open="${esc(url)}">在浏览器打开</button></div>`) +
        `</div>`;
    }
    return body;
  }
}
