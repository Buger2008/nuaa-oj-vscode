import * as vscode from 'vscode';
import { ProblemContext } from './context';
import { statusMeta } from './status';

export interface RecordsHost {
  fetchSubmissions(ctx: ProblemContext, onlyMine: boolean): Promise<{ records: any[]; total: number }>;
  getTestHistory(ctx: ProblemContext): Promise<any[]>;
  submissionUrl(submitId: number): string;
  openExternal(url: string): void;
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
  private disposables: vscode.Disposable[] = [];

  static key(ctx: ProblemContext): string {
    return `${ctx.kind}:${ctx.tid ?? 0}:${ctx.displayId}`;
  }

  static async show(
    ctx: ProblemContext,
    host: RecordsHost,
    extensionUri: vscode.Uri,
    tab: 'my' | 'all' | 'test',
  ): Promise<void> {
    const key = RecordsPanel.key(ctx);
    const existing = RecordsPanel.map.get(key);
    if (existing) {
      existing.tab = tab;
      existing.ctx = ctx;
      existing.panel.reveal(vscode.ViewColumn.Active, false);
      await existing.reload();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'nuaaOjRecords',
      `提交记录 · ${ctx.displayId}`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const p = new RecordsPanel(panel, ctx, host, extensionUri, tab);
    RecordsPanel.map.set(key, p);
    panel.onDidDispose(() => {
      RecordsPanel.map.delete(key);
      while (p.disposables.length) {
        try {
          p.disposables.pop()?.dispose();
        } catch {
          /* ignore */
        }
      }
    });
    await p.reload();
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
        if (m?.type === 'tab') {
          this.tab = m.tab;
          await this.reload();
        } else if (m?.type === 'open') {
          this.host.openExternal(String(m.url));
        } else if (m?.type === 'refresh') {
          await this.reload();
        }
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

  private render(): void {
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const tabBtn = (id: 'my' | 'all' | 'test', label: string) =>
      `<button class="tab ${this.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;

    let body = '';
    if (this.loading) {
      body = '<p class="muted">加载中…</p>';
    } else if (this.error) {
      body = `<p class="err">加载失败：${esc(this.error)}</p>`;
    } else if (!this.data.length) {
      body = `<p class="muted">${this.tab === 'test' ? '本次会话还没有测试记录。' : '暂无提交记录。'}</p>`;
    } else if (this.tab === 'test') {
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
        '<table><thead><tr><th>提交号</th>' +
        (showUser ? '<th>用户</th>' : '') +
        '<th>状态</th><th>时间</th><th>内存</th><th>语言</th><th>得分</th><th>提交时间</th></tr></thead><tbody>' +
        this.data
          .map((r) => {
            const st = statusMeta(r.status);
            const url = this.host.submissionUrl(r.submitId);
            return (
              `<tr class="row" data-url="${esc(url)}">` +
              `<td>#${r.submitId}</td>` +
              (showUser ? `<td>${esc(r.username || '')}</td>` : '') +
              `<td><span class="pill" style="background:${st.color}">${st.short}</span> ${esc(st.name)}</td>` +
              `<td>${r.time ?? '-'} ms</td><td>${r.memory ?? '-'} KB</td><td>${esc(r.language || '')}</td><td>${r.score ?? '-'}</td>` +
              `<td>${esc(fmtTime(r.submitTime))}</td></tr>`
            );
          })
          .join('') +
        '</tbody></table>';
    }

    this.panel.webview.html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
 body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:12px 18px;}
 h1{font-size:16px;margin:0 0 10px;}
 .tabs{display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:8px;}
 .tab{font-family:inherit;font-size:13px;padding:5px 12px;border-radius:4px;border:1px solid transparent;background:transparent;color:var(--vscode-foreground);cursor:pointer;}
 .tab.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
 table{border-collapse:collapse;width:100%;font-size:12.5px;}
 th,td{border-bottom:1px solid var(--vscode-panel-border);padding:6px 8px;text-align:left;}
 th{position:sticky;top:0;background:var(--vscode-editor-background);}
 tr.row{cursor:pointer;} tr.row:hover{background:rgba(127,127,127,.12);}
 .pill{display:inline-block;color:#fff;border-radius:10px;padding:0 8px;font-weight:700;font-size:11px;}
 .muted{color:var(--vscode-descriptionForeground);} .err{color:#f56c6c;}
</style></head><body>
<h1>提交记录 · ${esc(this.ctx.displayId)} ${esc(this.ctx.title)} <span class="muted">（共 ${this.total} 条${this.tab === 'test' ? '，仅本次会话' : ''}）</span></h1>
<div class="tabs">${tabBtn('my', '我的提交')}${tabBtn('all', '全部提交')}${tabBtn('test', '我的自测')}<button class="tab" data-tab="refresh">刷新</button></div>
${body}
<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 document.querySelectorAll('.tab').forEach((b)=>b.addEventListener('click',()=>{ const t=b.getAttribute('data-tab'); if(t==='refresh') vscode.postMessage({type:'refresh'}); else vscode.postMessage({type:'tab',tab:t}); }));
 document.querySelectorAll('tr.row').forEach((r)=>r.addEventListener('click',()=>vscode.postMessage({type:'open',url:r.getAttribute('data-url')})));
</script></body></html>`;
  }
}
