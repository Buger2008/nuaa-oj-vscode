import * as vscode from 'vscode';

export interface UserHomeHost {
  info(uid: string, username: string): Promise<any>;
  heatmap(uid: string, username: string): Promise<any>;
  submissions(username: string, page: number, size: number): Promise<{ records: any[]; total: number }>;
  submissionUrl(submitId: number): string;
  openExternal(url: string): void;
  openProblem(value: string): Promise<any> | void;
  openSubmission(submitId: number): Promise<any> | void;
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
      else if (m?.type === 'openProblem') void this.host.openProblem(String(m.value));
      else if (m?.type === 'openSubmission') void this.host.openSubmission(Number(m.submitId));
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
 .heat{display:grid;grid-auto-flow:column;grid-template-rows:repeat(7,11px);grid-auto-columns:11px;gap:2px;overflow-x:auto;padding-bottom:4px;}
 .diffs{max-width:520px;}
 .diffrow{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12.5px;}
 .diffrow .dl{width:52px;color:var(--vscode-descriptionForeground);}
 .diffrow .dbar{flex:1;height:12px;border-radius:6px;background:rgba(127,127,127,.2);overflow:hidden;}
 .diffrow .dbar i{display:block;height:100%;border-radius:6px;}
 .diffrow .dn{width:36px;text-align:right;font-weight:600;}
 .diffdet{margin:3px 0;}
 .diffdet>summary{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;list-style:none;}
 .diffdet>summary::-webkit-details-marker{display:none;}
 .diffdet>summary .dl{width:52px;color:var(--vscode-descriptionForeground);}
 .diffdet>summary .dbar{flex:1;height:12px;border-radius:6px;background:rgba(127,127,127,.2);overflow:hidden;}
 .diffdet>summary .dbar i{display:block;height:100%;border-radius:6px;}
 .diffdet>summary .dn{width:36px;text-align:right;font-weight:600;}
 .plist{display:flex;flex-wrap:wrap;gap:6px;padding:8px 4px 8px 60px;}
 .plink{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;padding:2px 8px;border-radius:10px;background:rgba(127,127,127,.18);color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:none;}
 .plink:hover{background:rgba(10,132,255,.25);}
 .cell{width:11px;height:11px;border-radius:2px;background:rgba(127,127,127,.15);}
 .cell.pad{background:transparent;}
 .rtip{position:fixed;z-index:99999;display:none;padding:4px 8px;border-radius:4px;font-size:12px;pointer-events:none;white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis;background:var(--vscode-editorHoverWidget-background,#252526);color:var(--vscode-editorHoverWidget-foreground,#fff);border:1px solid var(--vscode-panel-border);box-shadow:0 2px 8px rgba(0,0,0,.4);}
 table{border-collapse:collapse;width:100%;font-size:12px;} th,td{border-bottom:1px solid var(--vscode-panel-border);padding:5px 4px;text-align:left;white-space:nowrap;}
 th{font-weight:600;} tr:hover{background:rgba(127,127,127,.12);}
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
 const rtip=document.createElement('div'); rtip.className='rtip'; document.body.appendChild(rtip);
 function attachTips(root){ if(!root||!root.querySelectorAll) return; root.querySelectorAll('[data-tip]').forEach(function(el){ el.addEventListener('mousemove',function(e){ rtip.textContent=el.getAttribute('data-tip'); rtip.style.display='block'; var w=rtip.offsetWidth||0,h=rtip.offsetHeight||0; var vw=(window&&window.innerWidth)||9999,vh=(window&&window.innerHeight)||9999; var x=e.clientX+12; if(x+w>vw-6)x=e.clientX-w-12; if(x<4)x=4; var y=e.clientY+12; if(y+h>vh-6)y=e.clientY-h-12; if(y<4)y=4; rtip.style.left=x+'px'; rtip.style.top=y+'px'; }); el.addEventListener('mouseleave',function(){ rtip.style.display='none'; }); }); }
 function normUrl(v, kind){ v=String(v||''); if(/^https?:/i.test(v)) return v; if(kind==='github') return 'https://github.com/'+v.replace(/^@/,''); return 'https://'+v; }
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
   if(i && i.solvedGroupByDifficulty){
     const g=i.solvedGroupByDifficulty;
     const data=[['简单',g['1']||[],'#67c23a'],['中等',g['2']||[],'#e6a23c'],['困难',g['3']||[],'#f56c6c'],['未分类',g['0']||[],'#909399']];
     const max=Math.max(data[0][1].length,data[1][1].length,data[2][1].length,data[3][1].length,1);
     html+='<h2>已解决 · 按难度（点击展开）</h2><div class="diffs">';
     data.forEach(function(d){ const arr=d[1]; html+='<details class="diffdet"><summary><span class="dl">'+d[0]+'</span><div class="dbar"><i style="width:'+Math.round(arr.length/max*100)+'%;background:'+d[2]+'"></i></div><span class="dn">'+arr.length+'</span></summary><div class="plist">'; if(!arr.length){ html+='<span class="muted">（无）</span>'; } else { arr.forEach(function(p){ html+='<a class="plink" data-pid="'+esc(p.problemId)+'">'+esc(p.problemId)+'</a>'; }); } html+='</div></details>'; });
     html+='</div>';
   }
   if(state.heat && state.heat.endDate){
     const map={}; (state.heat.dataList||[]).forEach(function(x){ if(x&&x.date) map[String(x.date).slice(0,10)]=Number(x.count)||0; });
     const endStr=String(state.heat.endDate).slice(0,10);
     let max=1; Object.keys(map).forEach(function(k){ if(map[k]>max) max=map[k]; });
     const end=new Date(endStr+'T00:00:00');
     const start=new Date(end.getTime()); start.setDate(start.getDate()-364);
     const startStr=start.getFullYear()+'-'+('0'+(start.getMonth()+1)).slice(-2)+'-'+('0'+start.getDate()).slice(-2);
     let cells='';
     for(let p=0;p<start.getDay();p++){ cells+='<div class="cell pad"></div>'; }
     const cur=new Date(start.getTime());
     for(let i=0;i<365;i++){
       const y=cur.getFullYear(), mo=('0'+(cur.getMonth()+1)).slice(-2), da=('0'+cur.getDate()).slice(-2);
       const ds=y+'-'+mo+'-'+da; const c=map[ds]||0;
       const op=c? (0.2+0.8*(c/max)) : 0;
       const bg=c? 'rgba(10,132,255,'+op.toFixed(2)+')':'rgba(127,127,127,.15)';
       cells+='<div class="cell" data-tip="'+esc(ds)+' · '+c+' 次" style="background:'+bg+'"></div>';
       cur.setDate(cur.getDate()+1);
     }
     html+='<h2>近一年提交热力图（'+esc(startStr)+' ~ '+esc(endStr)+'）</h2><div class="heat">'+cells+'</div><div class="muted">颜色越深提交越多</div>';
   }
   html+='<h2>最近提交</h2>';
   if(state.subs){
     const d=state.subs;
     if(!d.items.length){ html+='<p class="muted">暂无提交</p>'; }
     else{
       html+='<table><thead><tr><th>RUNID</th><th>题目</th><th>状态</th><th>时间</th><th>内存</th><th>语言</th><th>提交时间</th></tr></thead><tbody>';
       d.items.forEach(function(r){ html+='<tr><td><a class="runid" data-sid="'+r.submitId+'">#'+r.submitId+'</a></td><td><a class="plink" data-pid="'+esc(r.displayPid)+'">'+esc((r.displayPid||'')+' '+(r.title||''))+'</a></td><td>'+esc(r.status)+'</td><td>'+esc(r.time)+' ms</td><td>'+esc(r.memory)+' KB</td><td>'+esc(r.language||'')+'</td><td>'+esc(r.submitTime? new Date(r.submitTime).toLocaleString():'')+'</td></tr>'; });
       html+='</tbody></table>';
       html+='<div class="pager"><button id="prev" '+(d.page<=1?'disabled':'')+'>‹ 上一页</button><span class="muted">第 '+d.page+' / '+d.pages+' 页 · 共 '+d.total+' 条</span><button id="next" '+(d.page>=d.pages?'disabled':'')+'>下一页 ›</button></div>';
     }
   } else if(state.subsError){ html+='<p class="muted">'+esc(state.subsError)+'</p>'; }
   root.innerHTML=html;
   attachTips(root);
   root.querySelectorAll('a.runid').forEach(function(a){ a.addEventListener('click',function(e){ e.preventDefault(); vscode.postMessage({type:'openSubmission', submitId:a.getAttribute('data-sid')}); }); });
   root.querySelectorAll('a.extlink').forEach(function(a){ a.addEventListener('click',function(e){ e.preventDefault(); vscode.postMessage({type:'openUrl',url:a.getAttribute('data-open')}); }); });
   root.querySelectorAll('a.plink').forEach(function(a){ a.addEventListener('click',function(e){ e.preventDefault(); vscode.postMessage({type:'openProblem', value:a.getAttribute('data-pid')}); }); });
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
