import * as vscode from 'vscode';

export interface ProfileHost {
  profile(): Promise<any>;
  advice(kind: 'knowledge' | 'method', onEvent: (ev: any) => void, signal: AbortSignal): Promise<void>;
}

export class ProfilePanel {
  private static current: ProfilePanel | undefined;
  private disposables: vscode.Disposable[] = [];
  private controllers: Record<string, AbortController | undefined> = {};
  private data: any = null;

  static async show(host: ProfileHost, extensionUri: vscode.Uri): Promise<void> {
    if (ProfilePanel.current) {
      ProfilePanel.current.panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }
    const panel = vscode.window.createWebviewPanel('nuaaOjProfile', '能力画像', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const p = new ProfilePanel(panel, host, extensionUri);
    ProfilePanel.current = p;
    panel.onDidDispose(() => {
      ProfilePanel.current = undefined;
      Object.values(p.controllers).forEach((c) => c?.abort());
      while (p.disposables.length) {
        try { p.disposables.pop()?.dispose(); } catch { /* ignore */ }
      }
    });
  }

  private constructor(
    private panel: vscode.WebviewPanel,
    private host: ProfileHost,
    private extensionUri: vscode.Uri,
  ) {
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources')],
    };
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage(async (m) => {
      if (m?.type === 'ready') await this.loadAll();
      else if (m?.type === 'refreshAdvice') await this.runAdvice(String(m.kind) === 'method' ? 'method' : 'knowledge');
    }, null, this.disposables);
  }

  private post(msg: any): void {
    try { void this.panel.webview.postMessage(msg); } catch { /* ignore */ }
  }

  private async loadAll(): Promise<void> {
    try {
      this.data = await this.host.profile();
      this.postProfile();
    } catch (e: any) {
      this.post({ type: 'profileError', text: e?.message ?? String(e) });
    }
    void this.runAdvice('knowledge');
    void this.runAdvice('method');
  }

  private postProfile(): void {
    if (!this.data) return;
    this.post({ type: 'profile', data: this.data });
  }

  private async runAdvice(kind: 'knowledge' | 'method'): Promise<void> {
    this.controllers[kind]?.abort();
    const ctrl = new AbortController();
    this.controllers[kind] = ctrl;
    this.post({ type: 'adviceStart', kind });
    try {
      await this.host.advice(kind, (ev) => {
        if (ev && typeof ev.t === 'string') this.post({ type: 'adviceChunk', kind, text: ev.t });
      }, ctrl.signal);
      this.post({ type: 'adviceDone', kind });
    } catch (e: any) {
      if (e?.name !== 'AbortError') this.post({ type: 'adviceError', kind, text: e?.message ?? String(e) });
    }
  }

  private html(): string {
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const mdUri = this.panel.webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'vendor', 'markdown-it.min.js'))
      .toString();
    const csp = this.panel.webview.cspSource;
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp};" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
 body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:16px 20px;font-size:13px;}
 h1{font-size:18px;margin:0 0 4px;} h2{font-size:14px;margin:18px 0 8px;border-left:3px solid var(--vscode-focusBorder);padding-left:8px;}
 .radar{display:flex;justify-content:center;margin:6px 0;color:var(--vscode-foreground);}
 .muted{color:var(--vscode-descriptionForeground);font-size:12px;}
 .cap{display:grid;grid-template-columns:110px 1fr 44px;gap:8px 10px;align-items:center;margin:6px 0;}
 .cap .name{font-weight:600;} .cap .pct{text-align:right;color:var(--vscode-descriptionForeground);}
 .bar{height:12px;border-radius:6px;background:rgba(127,127,127,.2);overflow:hidden;}
 .bar>i{display:block;height:100%;border-radius:6px;}
 .kp{display:grid;grid-template-columns:150px 1fr 40px;gap:8px 10px;align-items:center;margin:4px 0;font-size:12.5px;}
 .kp .bar{height:9px;}
 .advice{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:10px 12px;background:rgba(127,127,127,.06);min-height:80px;line-height:1.55;white-space:pre-wrap;}
 .advice.md{white-space:normal;}
 .advice.md p{margin:6px 0;} .advice.md code{font-family:var(--vscode-editor-font-family,monospace);background:rgba(127,127,127,.25);padding:1px 4px;border-radius:3px;}
 .advice.md pre{background:var(--vscode-textCodeBlock-background,rgba(127,127,127,.25));padding:8px;border-radius:6px;overflow:auto;}
 .advice.md ul,.advice.md ol{padding-left:20px;}
 .streaming::after{content:'▋';opacity:.6;}
 .sec-head{display:flex;align-items:center;gap:8px;}
 .sec-head button{font-family:inherit;font-size:12px;padding:3px 8px;border-radius:4px;border:1px solid var(--vscode-panel-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer;}
</style></head><body>
<h1>能力画像</h1>
<div class="muted" id="meta">加载中…</div>

<h2>知识能力画像</h2>
<div id="radarK" class="radar"></div>

<h2>能力维度</h2>
<div id="radarC" class="radar"></div>
<div id="caps"></div>

<h2>知识点掌握（Top）</h2>
<div id="kps"></div>

<h2><span class="sec-head">📘 知识点建议 <button data-refresh="knowledge">刷新</button></span></h2>
<div class="advice streaming" id="advK"></div>

<h2><span class="sec-head">🧭 学习方法建议 <button data-refresh="method">刷新</button></span></h2>
<div class="advice streaming" id="advM"></div>

<script nonce="${nonce}" src="${mdUri}"></script>
<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 const md = (window.markdownit ? window.markdownit({breaks:true, linkify:true}) : null);
 function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
 function radar(labels, vals, color){
   const n=labels.length; if(!n) return '<div class="muted">暂无数据</div>';
   const S=250, c=S/2, R=S/2-44;
   function pt(i,r){ const a=-Math.PI/2 + i*2*Math.PI/n; return [c+r*Math.cos(a), c+r*Math.sin(a)]; }
   let s='<svg viewBox="0 0 '+S+' '+S+'" width="'+S+'" height="'+S+'">';
   [0.25,0.5,0.75,1].forEach(function(f){ let ps=[]; for(let i=0;i<n;i++){ const p=pt(i,R*f); ps.push(p[0].toFixed(1)+','+p[1].toFixed(1)); } s+='<polygon points="'+ps.join(' ')+'" fill="none" stroke="rgba(127,127,127,.35)" stroke-width="1"/>'; });
   for(let i=0;i<n;i++){ const p=pt(i,R); s+='<line x1="'+c+'" y1="'+c+'" x2="'+p[0].toFixed(1)+'" y2="'+p[1].toFixed(1)+'" stroke="rgba(127,127,127,.3)"/>'; }
   let dp=[]; for(let i=0;i<n;i++){ const v=Math.max(0,Math.min(1,vals[i]||0)); const p=pt(i,R*v); dp.push(p[0].toFixed(1)+','+p[1].toFixed(1)); }
   s+='<polygon points="'+dp.join(' ')+'" fill="'+color+'33" stroke="'+color+'" stroke-width="2"/>';
   for(let i=0;i<n;i++){ const p=pt(i,R+15); s+='<text x="'+p[0].toFixed(1)+'" y="'+p[1].toFixed(1)+'" font-size="11" fill="currentColor" text-anchor="middle" dominant-baseline="middle">'+esc(labels[i])+'</text>'; }
   s+='</svg>'; return s;
 }
 function buildRadarK(d){
   const kp=d.knowledge_profile||{}, kl=d.knowledge_labels||{}, cnt=d.knowledge_submission_counts||{};
   let keys=Object.keys(kp); keys.sort(function(a,b){ return (Number(cnt[b])||0)-(Number(cnt[a])||0); }); keys=keys.slice(0,8);
   return radar(keys.map(function(k){return kl[k]||k;}), keys.map(function(k){return Number(kp[k])||0;}), '#8b5cf6');
 }
 const capsEl=document.getElementById('caps'), kpsEl=document.getElementById('kps'), metaEl=document.getElementById('meta');
 const adv={knowledge:{el:document.getElementById('advK'),text:'',done:false}, method:{el:document.getElementById('advM'),text:'',done:false}};
 function color(s){ const x=Math.max(0,Math.min(1,s)); const r=Math.round(244-(244-103)*x), g=Math.round(67+(194-67)*x), b=Math.round(54+(58-54)*x); return 'rgb('+r+','+g+','+b+')'; }
 function renderProfile(d){
   if(!d){ return; }
   metaEl.textContent='数据时间：'+(d.data_as_of||d.updated_at||'')+(d.sample_size&&d.sample_size.total?' · 样本 '+d.sample_size.total:'');
   const cp=d.capability_profile||{}; const cm=d.capability_metadata||{};
   const rk=document.getElementById('radarK'); if(rk) rk.innerHTML=buildRadarK(d);
   const rc=document.getElementById('radarC'); if(rc) rc.innerHTML=radar(Object.keys(cp), Object.keys(cp).map(function(k){return Number(cp[k])||0;}), '#3b82f6');
   capsEl.innerHTML='';
   Object.keys(cp).forEach(function(k){
     const v=Number(cp[k])||0; const row=document.createElement('div'); row.className='cap';
     const n=document.createElement('div'); n.className='name'; n.textContent=k; n.title=(cm[k]&&cm[k].description)||'';
     const bar=document.createElement('div'); bar.className='bar'; const i=document.createElement('i'); i.style.width=Math.round(v*100)+'%'; i.style.background=color(v); bar.appendChild(i);
     const p=document.createElement('div'); p.className='pct'; p.textContent=Math.round(v*100)+'%';
     row.appendChild(n); row.appendChild(bar); row.appendChild(p); capsEl.appendChild(row);
   });
   const kp=d.knowledge_profile||{}; const kl=d.knowledge_labels||{};
   const arr=Object.keys(kp).map(function(k){ return {k:k, v:Number(kp[k])||0}; }).sort(function(a,b){return b.v-a.v;}).slice(0,12);
   kpsEl.innerHTML='';
   arr.forEach(function(o){
     const row=document.createElement('div'); row.className='kp';
     const n=document.createElement('div'); n.textContent=kl[o.k]||o.k;
     const bar=document.createElement('div'); bar.className='bar'; const i=document.createElement('i'); i.style.width=Math.round(Math.max(0,Math.min(1,o.v))*100)+'%'; i.style.background=color(o.v); bar.appendChild(i);
     const p=document.createElement('div'); p.className='pct'; p.textContent=Math.round(o.v*100)+'%';
     row.appendChild(n); row.appendChild(bar); row.appendChild(p); kpsEl.appendChild(row);
   });
   if(!arr.length) kpsEl.appendChild(document.createTextNode('暂无知识点数据'));
 }
 function renderAdvice(kind){
   const a=adv[kind]; if(!a) return;
   if(a.done && md){ a.el.classList.add('md'); a.el.innerHTML=md.render(a.text||''); a.el.classList.remove('streaming'); }
   else { a.el.textContent=a.text; a.el.classList.add('streaming'); }
 }
 document.querySelectorAll('[data-refresh]').forEach(function(b){ b.addEventListener('click',function(){ const k=b.getAttribute('data-refresh'); adv[k].text=''; adv[k].done=false; renderAdvice(k); vscode.postMessage({type:'refreshAdvice', kind:k}); }); });
 window.addEventListener('message',function(e){ const m=e.data;
   if(m.type==='profile'){ renderProfile(m.data); }
   else if(m.type==='profileError'){ metaEl.textContent='加载失败：'+m.text; }
   else if(m.type==='adviceStart'){ const a=adv[m.kind]; if(a){ a.text=''; a.done=false; a.el.classList.add('streaming'); a.el.textContent=''; } }
   else if(m.type==='adviceChunk'){ const a=adv[m.kind]; if(a){ a.text+=m.text; renderAdvice(m.kind); } }
   else if(m.type==='adviceDone'){ const a=adv[m.kind]; if(a){ a.done=true; renderAdvice(m.kind); } }
   else if(m.type==='adviceError'){ const a=adv[m.kind]; if(a){ a.done=true; a.text=(a.text||'')+'\\n（出错：'+m.text+'）'; renderAdvice(m.kind); } }
 });
 vscode.postMessage({type:'ready'});
</script></body></html>`;
  }
}
