import * as vscode from 'vscode';

export interface MessagesHost {
  list(page: number, size: number): Promise<{ records: any[]; total: number }>;
}

export class MessagesPanel {
  private static current: MessagesPanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private page = 1;
  private size = 10;
  private total = 0;
  private items: any[] = [];

  static async show(host: MessagesHost, extensionUri: vscode.Uri): Promise<void> {
    if (MessagesPanel.current) {
      MessagesPanel.current.panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }
    const panel = vscode.window.createWebviewPanel('nuaaOjMessages', '系统通知', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const p = new MessagesPanel(panel, host, extensionUri);
    MessagesPanel.current = p;
    panel.onDidDispose(() => {
      MessagesPanel.current = undefined;
      while (p.disposables.length) { try { p.disposables.pop()?.dispose(); } catch { /* ignore */ } }
    });
  }

  private constructor(private panel: vscode.WebviewPanel, private host: MessagesHost, private extensionUri: vscode.Uri) {
    this.panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources')] };
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage(async (m) => {
      if (m?.type === 'ready') await this.load();
      else if (m?.type === 'page') { this.page = Math.max(1, Number(m.page) || 1); await this.load(); }
      else if (m?.type === 'refresh') await this.load();
    }, null, this.disposables);
  }

  private post(msg: any): void { try { void this.panel.webview.postMessage(msg); } catch { /* ignore */ } }

  private async load(): Promise<void> {
    this.post({ type: 'loading' });
    try {
      const r = await this.host.list(this.page, this.size);
      this.items = r.records || [];
      this.total = r.total || 0;
      this.post({ type: 'list', items: this.items, page: this.page, size: this.size, total: this.total, pages: Math.max(1, Math.ceil(this.total / this.size)) });
    } catch (e: any) {
      this.post({ type: 'error', text: e?.message ?? String(e) });
    }
  }

  private html(): string {
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const mdUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'vendor', 'markdown-it.min.js')).toString();
    const csp = this.panel.webview.cspSource;
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
 body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:14px 20px;font-size:13px;}
 h1{font-size:18px;margin:0 0 4px;}
 .muted{color:var(--vscode-descriptionForeground);font-size:12px;}
 .item{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:10px 12px;margin:10px 0;}
 .item>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;}
 .item>summary::-webkit-details-marker{display:none;}
 .item .title{font-weight:600;flex:1;}
 .dot{width:8px;height:8px;border-radius:50%;background:#0a84ff;flex:none;}
 .time{font-size:11.5px;color:var(--vscode-descriptionForeground);white-space:nowrap;}
 .content{margin-top:8px;padding-top:8px;border-top:1px solid var(--vscode-panel-border);line-height:1.55;}
 .content.md p{margin:6px 0;} .content.md code{font-family:var(--vscode-editor-font-family,monospace);background:rgba(127,127,127,.25);padding:1px 4px;border-radius:3px;}
 .content.md pre{background:var(--vscode-textCodeBlock-background,rgba(127,127,127,.25));padding:8px;border-radius:6px;overflow:auto;}
 .pager{display:flex;gap:8px;align-items:center;justify-content:center;margin:14px 0;}
 .pager button{font-family:inherit;font-size:12.5px;padding:4px 12px;border-radius:4px;border:1px solid var(--vscode-panel-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer;}
 .pager button:disabled{opacity:.4;cursor:default;}
 .empty{padding:16px;color:var(--vscode-descriptionForeground);}
</style></head><body>
<h1>系统通知</h1>
<div class="muted" id="meta"></div>
<div id="list"><p class="empty">加载中…</p></div>
<script nonce="${nonce}" src="${mdUri}"></script>
<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 const md = (window.markdownit ? window.markdownit({breaks:true, linkify:true, html:false}) : null);
 const listEl=document.getElementById('list'), metaEl=document.getElementById('meta');
 function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
 function fmt(t){ try{ return new Date(t).toLocaleString(); }catch(e){ return String(t||''); } }
 function render(items,page,pages,total){
   metaEl.textContent='共 '+total+' 条 · 第 '+page+' / '+pages+' 页';
   if(!items || !items.length){ listEl.innerHTML='<p class="empty">暂无系统通知</p>'; return; }
   let h='';
   items.forEach(function(it){
     const unread = it.state===false ? '<span class="dot"></span>' : '';
     const body = md ? md.render(it.content||'') : esc(it.content||'').replace(/\\n/g,'<br>');
     h+='<details class="item"><summary>'+unread+'<span class="title">'+esc(it.title||'（无标题）')+'</span><span class="time">'+esc(fmt(it.gmtCreate))+'</span></summary><div class="content md">'+body+'</div></details>';
   });
   h+='<div class="pager"><button id="prev" '+(page<=1?'disabled':'')+'>‹ 上一页</button><button id="refresh">刷新</button><button id="next" '+(page>=pages?'disabled':'')+'>下一页 ›</button></div>';
   listEl.innerHTML=h;
   const pv=document.getElementById('prev'); if(pv) pv.addEventListener('click',function(){ vscode.postMessage({type:'page',page:page-1}); });
   const nx=document.getElementById('next'); if(nx) nx.addEventListener('click',function(){ vscode.postMessage({type:'page',page:page+1}); });
   const rf=document.getElementById('refresh'); if(rf) rf.addEventListener('click',function(){ vscode.postMessage({type:'refresh'}); });
 }
 window.addEventListener('message',function(e){ const m=e.data;
   if(m.type==='list'){ render(m.items, m.page, m.pages, m.total); }
   else if(m.type==='loading'){ listEl.innerHTML='<p class="empty">加载中…</p>'; }
   else if(m.type==='error'){ listEl.innerHTML='<p class="empty">加载失败：'+esc(m.text)+'</p>'; }
 });
 vscode.postMessage({type:'ready'});
</script></body></html>`;
  }
}
