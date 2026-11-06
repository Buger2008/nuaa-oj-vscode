import * as vscode from 'vscode';

export interface UserHomeHost {
  info(uid: string, username: string): Promise<any>;
  heatmap(uid: string, username: string): Promise<any>;
  submissions(username: string, page: number, size: number): Promise<{ records: any[]; total: number }>;
  submissionUrl(submitId: number): string;
  openExternal(url: string): void;
}

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class UserHomePanel {
  private disposables: vscode.Disposable[] = [];
  private info: any = null;
  private heat: any = null;
  private page = 1;
  private size = 30;
  private subs: any[] = [];
  private subTotal = 0;

  static async show(host: UserHomeHost, extensionUri: vscode.Uri, uid: string, username: string): Promise<void> {
    const panel = vscode.window.createWebviewPanel('nuaaOjUser', `个人主页 · ${username}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const p = new UserHomePanel(panel, host, extensionUri, uid, username);
    panel.onDidDispose(() => {
      while (p.disposables.length) { try { p.disposables.pop()?.dispose(); } catch { /* ignore */ } }
    });
  }

  private constructor(
    private panel: vscode.WebviewPanel,
    private host: UserHomeHost,
    private extensionUri: vscode.Uri,
    private uid: string,
    private username: string,
  ) {
    this.panel.webview.options = { enableScripts: true };
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage(async (m) => {
      if (m?.type === 'ready') await this.loadAll();
      else if (m?.type === 'page') { this.page = Math.max(1, Number(m.page) || 1); await this.loadSubs(); }
      else if (m?.type === 'openUrl') this.host.openExternal(String(m.url));
    }, null, this.disposables);
  }

  private post(msg: any): void { try { void this.panel.webview.postMessage(msg); } catch { /* ignore */ } }

  private async loadAll(): Promise<void> {
    try {
      this.info = await this.host.info(this.uid, this.username);
      this.post({ type: 'info', info: this.info, acCount: (this.info?.solvedList || []).length, scoreSum: (this.info?.scoreList || []).reduce((a: number, b: any) => a + (Number(b) || 0), 0) });
    } catch (e: any) { this.post({ type: 'infoError', text: e?.message ?? String(e) }); }
    try {
      this.heat = await this.host.heatmap(this.uid, this.username);
      this.post({ type: 'heatmap', heatmap: this.heat });
    } catch { /* ignore */ }
    await this.loadSubs();
  }

  private async loadSubs(): Promise<void> {
    try {
      const res = await this.host.submissions(this.username, this.page, this.size);
      this.subs = res.records || [];
      this.subTotal = res.total || 0;
      const pages = Math.max(1, Math.ceil(this.subTotal / this.size));
      this.post({ type: 'subs', items: this.subs.map((r: any) => ({
        submitId: r.submitId, displayPid: r.displayPid ?? r.pid, title: r.title, status: r.status,
        time: r.time, memory: r.memory, language: r.language, submitTime: r.submitTime,
        url: this.host.submissionUrl(r.submitId),
      })), page: this.page, size: this.size, total: this.subTotal, pages });
    } catch (e: any) { this.post({ type: 'subsError', text: e?.message ?? String(e) }); }
  }

  private html(): string {
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src * data:; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
 body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:16px 22px;font-size:13px;}
 .card{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:16px;display:flex;gap:16px;align-items:center;margin-bottom:14px;}
 .avatar{width:72px;height:72px;border-radius:50%;object-fit:cover;background:rgba(127,127,127,.2);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:var(--vscode-foreground);}
 .name{font-size:18px;font-weight:700;} .muted{color:var(--vscode-descriptionForeground);font-size:12px;}
 .pill{display:inline-block;color:#fff;border-radius:8px;padding:0 6px;font-size:11px;font-weight:700;}
 .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
 .stat{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:10px;text-align:center;}
 .stat .n{font-size:20px;font-weight:700;} .stat .l{font-size:12px;color:var(--vscode-descriptionForeground);}
 h2{font-size:14px;margin:16px 0 8px;border-left:3px solid var(--vscode-focusBorder);padding-left:8px;}
 .heat{display:flex;gap:3px;flex-wrap:wrap;}
 .cell{width:14px;height:14px;border-radius:3px;background:rgba(127,127,127,.18);}
 table{border-collapse:collapse;width:100%;font-size:12px;} th,td{border-bottom:1px solid var(--vscode-panel-border);padding:5px 4px;text-align:left;white-space:nowrap;}
 th{position:sticky;top:0;background:inherit;} tr:hover{background:rgba(127,127,127,.12);}
 a.runid{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:underline;}
 a.extlink{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:underline;}
 .pager{display:flex;gap:6px;align-items:center;justify-content:center;margin:10px 0;}
 .pager button{font-family:inherit;font-size:12px;padding:3px 10px;border-radius:4px;border:1px solid var(--vscode-panel-border);background:transparent;color:var(--vscode-foreground);cursor:pointer;}
 .pager button:disabled{opacity:.4;cursor:default;}
</style></head><body>
<div id="root"><p class="muted">加载中…</p></div>
<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 const root = document.getElementById('root');
 function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
 function normUrl(v, kind){ v=String(v||''); if(/^https?:\/\//i.test(v)) return v; if(kind==='github') return 'https://github.com/'+v.replace(/^@/,''); return 'https://'+v; }
 let state={ info:null, acCount:0, scoreSum:0, heat:null, subs:null };
 function render(){
   const i=state.info;
   let html='';
   if(i){
     const initial=(i.nickname||i.username||'?').slice(0,1).toUpperCase();
     html+='<div class="card">';
     html+= i.avatar? '<img class="avatar" src="'+esc(i.avatar)+'"/>' : '<div class="avatar">'+esc(initial)+'</div>';
     html+='<div><div class="name">'+esc(i.nickname||i.username)+' <span class="muted">@'+esc(i.username)+'</span>';
     if(i.titleName) html+=' <span class="pill" style="background:'+esc(i.titleColor||'#409eff')+'">'+esc(i.titleName)+'</span>';
     html+='</div>';
     if(i.school) html+='<div class="muted">🏫 '+esc(i.school)+'</div>';
     if(i.signature) html+='<div class="muted">'+esc(i.signature)+'</div>';
     if(i.blog) html+='<div class="muted">🔗 博客：<a class="extlink" data-open="'+esc(normUrl(i.blog,''))+'">'+esc(i.blog)+'</a></div>';
     if(i.github) html+='<div class="muted">🐙 GitHub：<a class="extlink" data-open="'+esc(normUrl(i.github,'github'))+'">'+esc(i.github)+'</a></div>';
     if(i.recentLoginTime) html+='<div class="muted">最近登录：'+esc(i.recentLoginTime)+'</div>';
     html+='</div></div>';
     html+='<div class="stats">';
     html+='<div class="stat"><div class="n">'+state.acCount+'</div><div class="l">AC 题数</div></div>';
     html+='<div class="stat"><div class="n">'+(i.total!=null?i.total:0)+'</div><div class="l">总提交</div></div>';
     html+='<div class="stat"><div class="n">'+state.scoreSum+'</div><div class="l">总分</div></div>';
     html+='<div class="stat"><div class="n">'+(i.rating!=null?i.rating:'--')+'</div><div class="l">Rating</div></div>';
     html+='</div>';
   } else { html+='<p class="muted">'+esc(state.infoError||'加载中…')+'</p>'; }
   if(state.heat && state.heat.dataList){
     const list=state.heat.dataList; const max=Math.max.apply(null,list.map(function(x){return x.count||0;}).concat([1]));
     html+='<h2>近期活跃（截止 '+esc(state.heat.endDate||'')+'）</h2><div class="heat">';
     list.forEach(function(x){ const c=x.count||0; const op=c? (0.25+0.75*(c/max)) : 0; const bg=c? 'rgba(10,132,255,'+op.toFixed(2)+')':'rgba(127,127,127,.18)'; html+='<div class="cell" title="'+esc(x.date)+'：'+(x.count||0)+' 次" style="background:'+bg+'"></div>'; });
     html+='</div>';
   }
   html+='<h2>最近提交</h2>';
   if(state.subs){
     const d=state.subs;
     if(!d.items.length){ html+='<p class="muted">暂无提交</p>'; }
     else{
       html+='<table><thead><tr><th>RUNID</th><th>题目</th><th>状态</th><th>时间</th><th>内存</th><th>语言</th><th>提交时间</th></tr></thead><tbody>';
       d.items.forEach(function(r){ html+='<tr><td><a class="runid" data-url="'+esc(r.url)+'">#'+r.submitId+'</a></td><td>'+esc((r.displayPid||'')+' '+(r.title||''))+'</td><td>'+esc(r.status)+'</td><td>'+esc(r.time)+' ms</td><td>'+esc(r.memory)+' KB</td><td>'+esc(r.language||'')+'</td><td>'+esc(r.submitTime? new Date(r.submitTime).toLocaleString():'')+'</td></tr>'; });
       html+='</tbody></table>';
       html+='<div class="pager"><button id="prev" '+(d.page<=1?'disabled':'')+'>‹ 上一页</button><span class="muted">第 '+d.page+' / '+d.pages+' 页 · 共 '+d.total+' 条</span><button id="next" '+(d.page>=d.pages?'disabled':'')+'>下一页 ›</button></div>';
     }
   } else if(state.subsError){ html+='<p class="muted">'+esc(state.subsError)+'</p>'; }
   root.innerHTML=html;
   root.querySelectorAll('a.runid').forEach(function(a){ a.addEventListener('click',function(e){ e.preventDefault(); vscode.postMessage({type:'openUrl',url:a.getAttribute('data-url')}); }); });
   root.querySelectorAll('a.extlink').forEach(function(a){ a.addEventListener('click',function(e){ e.preventDefault(); vscode.postMessage({type:'openUrl',url:a.getAttribute('data-open')}); }); });
   const pv=document.getElementById('prev'); if(pv) pv.addEventListener('click',function(){ vscode.postMessage({type:'page',page:state.subs.page-1}); });
   const nx=document.getElementById('next'); if(nx) nx.addEventListener('click',function(){ vscode.postMessage({type:'page',page:state.subs.page+1}); });
 }
 window.addEventListener('message',function(e){ const m=e.data;
   if(m.type==='info'){ state.info=m.info; state.acCount=m.acCount||0; state.scoreSum=m.scoreSum||0; render(); }
   else if(m.type==='infoError'){ state.infoError=m.text; render(); }
   else if(m.type==='heatmap'){ state.heat=m.heatmap; render(); }
   else if(m.type==='subs'){ state.subs=m; render(); }
   else if(m.type==='subsError'){ state.subsError=m.text; render(); }
 });
 vscode.postMessage({type:'ready'});
</script></body></html>`;
  }
}
