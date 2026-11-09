import * as vscode from 'vscode';

export interface LearningMapHost {
  data(): Promise<any>;
  knowledge(kpId: string): Promise<any>;
}

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DIMS = ['正确解题', '难题攻克', '调试改进', '代码结构', '迁移应用', '运行效率'];

export class LearningMapPanel {
  private static current: LearningMapPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  static async show(host: LearningMapHost, extensionUri: vscode.Uri): Promise<void> {
    if (LearningMapPanel.current) {
      LearningMapPanel.current.panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }
    const panel = vscode.window.createWebviewPanel('nuaaOjLearningMap', '学习地图', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const p = new LearningMapPanel(panel, host, extensionUri);
    LearningMapPanel.current = p;
    panel.onDidDispose(() => {
      LearningMapPanel.current = undefined;
      while (p.disposables.length) { try { p.disposables.pop()?.dispose(); } catch { /* ignore */ } }
    });
  }

  private constructor(private panel: vscode.WebviewPanel, private host: LearningMapHost, private extensionUri: vscode.Uri) {
    this.panel.webview.options = { enableScripts: true };
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage(async (m) => {
      if (m?.type === 'ready' || m?.type === 'refresh') await this.loadMap();
      else if (m?.type === 'knowledge') await this.loadKnowledge(String(m.kpId || ''));
    }, null, this.disposables);
  }

  private post(msg: any): void { try { void this.panel.webview.postMessage(msg); } catch { /* ignore */ } }

  private async loadMap(): Promise<void> {
    this.post({ type: 'loading' });
    try {
      const data = await this.host.data();
      const current = data?.overview?.map?.course?.current_topic || '';
      this.post({ type: 'map', data, current });
      await this.loadKnowledge(current);
    } catch (e: any) {
      this.post({ type: 'error', text: e?.message ?? String(e) });
    }
  }

  private async loadKnowledge(kpId: string): Promise<void> {
    if (!kpId) return;
    this.post({ type: 'knowledgeLoading', kpId });
    try {
      this.post({ type: 'knowledge', kpId, data: await this.host.knowledge(kpId) });
    } catch (e: any) {
      this.post({ type: 'knowledgeError', kpId, text: e?.message ?? String(e) });
    }
  }

  private html(): string {
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
 body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:16px 22px;font-size:13px;}
 h1{font-size:18px;margin:0 0 4px;}
 h2{font-size:14px;margin:16px 0 8px;border-left:3px solid var(--vscode-focusBorder);padding-left:8px;}
 .muted{color:var(--vscode-descriptionForeground);font-size:12px;}
 .btn{font-family:inherit;font-size:12.5px;padding:5px 12px;border-radius:4px;border:1px solid transparent;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer;}
 .top{display:grid;grid-template-columns:minmax(280px,1fr) minmax(260px,1fr);gap:14px;}
 .legend{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--vscode-descriptionForeground);margin:8px 0;}
 .dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-left:8px;}
 .dot.done{background:#67c23a;} .dot.doing{background:#0a84ff;} .dot.locked{background:#909399;}
 .map{overflow-x:auto;border:1px solid var(--vscode-panel-border);border-radius:10px;padding:12px;background:rgba(127,127,127,.05);margin-bottom:12px;}
 .cols{display:flex;gap:22px;align-items:flex-start;}
 .col{min-width:172px;flex:none;}
 .node{border:1.5px solid #67c23a;border-radius:8px;padding:6px 8px;margin:4px 0;cursor:pointer;font-size:12px;background:var(--vscode-editor-background);}
 .node .t1{font-weight:700;font-size:12.5px;}
 .node .meta{font-size:10.5px;color:var(--vscode-descriptionForeground);margin-top:2px;}
 .node.done{border-color:#67c23a;} .node.doing{border-color:#0a84ff;} .node.locked{border-color:#909399;opacity:.75;}
 .node.selected{box-shadow:0 0 0 2px var(--vscode-focusBorder) inset;}
 .node .bar2{height:4px;border-radius:2px;background:rgba(127,127,127,.25);margin-top:4px;overflow:hidden;}
 .node .bar2 i{display:block;height:100%;}
 .children{margin-left:12px;padding-left:10px;border-left:1px dashed var(--vscode-panel-border);}
 .card{border:1px solid var(--vscode-panel-border);border-radius:10px;padding:12px 14px;}
 .card .head{font-size:12px;letter-spacing:.08em;color:var(--vscode-descriptionForeground);text-transform:uppercase;margin-bottom:2px;}
 .kpname{font-size:17px;font-weight:700;margin-bottom:4px;}
 .radar{display:flex;justify-content:center;margin:6px 0;color:var(--vscode-foreground);}
 .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px;}
 .metric{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:8px;}
 .metric .score{font-size:16px;font-weight:700;} .metric .dim{font-size:11.5px;color:var(--vscode-descriptionForeground);}
 .metric .samp{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;}
 .chipwrap{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 12px;}
 .chip{font-size:12px;padding:3px 9px;border-radius:12px;border:1px solid;cursor:pointer;background:transparent;}
 .chip.unlocked{color:#67c23a;border-color:#67c23a;}
 .chip.locked{color:var(--vscode-descriptionForeground);border-color:var(--vscode-panel-border);}
 .chip.active{background:#0a84ff;border-color:#0a84ff;color:#fff;font-weight:600;}
 .badge{display:inline-block;font-size:12px;padding:2px 10px;border-radius:10px;color:#fff;margin-bottom:4px;}
 .badge.ok{background:#67c23a;} .badge.lock{background:#909399;}
</style></head><body>
<h1>学习地图</h1>
<div class="muted" id="sub">加载中…</div>
<div><button class="btn" id="btn-refresh">刷新</button></div>
<div class="legend"><span>状态：</span><span class="dot done"></span>已完成 <span class="dot doing"></span>进行中 <span class="dot locked"></span>未解锁</div>
<div id="mapwrap"></div>
<div class="top">
  <div class="card">
    <div class="head">Capability</div>
    <div class="kpname" id="kpname">—</div>
    <div class="muted">基于该知识点相关题目的六维学习能力</div>
    <div class="radar" id="radar"></div>
    <div class="metrics" id="metrics"></div>
  </div>
  <div class="card">
    <div class="head">Progress</div>
    <div class="kpname">知识点解锁进度</div>
    <div id="progress"></div>
  </div>
</div>
<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 const rootSub=document.getElementById('sub'), radarEl=document.getElementById('radar'), metricsEl=document.getElementById('metrics'), progressEl=document.getElementById('progress'), kpnameEl=document.getElementById('kpname'), mapwrap=document.getElementById('mapwrap');
 document.getElementById('btn-refresh').addEventListener('click',()=>vscode.postMessage({type:'refresh'}));
 function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
 const DIMS=['正确解题','难题攻克','调试改进','代码结构','迁移应用','运行效率'];
 let state={map:null, kps:[], selected:'', course:{}, currentData:null};
 function flatten(ns,out){ ns.forEach(function(n){ out.push(n); if(Array.isArray(n.children)&&n.children.length) flatten(n.children,out); }); return out; }
 function radar(labels,vals,color){
   const n=labels.length; if(!n) return '';
   const S=250,c=S/2,R=S/2-46;
   function pt(i,r){ const a=-Math.PI/2+i*2*Math.PI/n; return [c+r*Math.cos(a), c+r*Math.sin(a)]; }
   let s='<svg viewBox="0 0 '+S+' '+S+'" width="'+S+'" height="'+S+'">';
   [0.25,0.5,0.75,1].forEach(function(f){ let ps=[]; for(let i=0;i<n;i++){ const p=pt(i,R*f); ps.push(p[0].toFixed(1)+','+p[1].toFixed(1)); } s+='<polygon points="'+ps.join(' ')+'" fill="none" stroke="rgba(127,127,127,.3)" stroke-width="1"/>'; });
   for(let i=0;i<n;i++){ const p=pt(i,R); s+='<line x1="'+c+'" y1="'+c+'" x2="'+p[0].toFixed(1)+'" y2="'+p[1].toFixed(1)+'" stroke="rgba(127,127,127,.25)"/>'; }
   let dp=[]; for(let i=0;i<n;i++){ const v=Math.max(0,Math.min(1,Number(vals[i])||0)); const p=pt(i,R*v); dp.push(p[0].toFixed(1)+','+p[1].toFixed(1)); }
   s+='<polygon points="'+dp.join(' ')+'" fill="'+color+'33" stroke="'+color+'" stroke-width="2"/>';
   for(let i=0;i<n;i++){ const p=pt(i,R+16); s+='<text x="'+p[0].toFixed(1)+'" y="'+p[1].toFixed(1)+'" font-size="10" fill="currentColor" text-anchor="middle" dominant-baseline="middle">'+esc(labels[i])+'</text>'; }
   s+='</svg>'; return s;
 }
 function renderMap(data,current){
   const map=data&&data.overview&&data.overview.map; if(!map){ progressEl.innerHTML='<p class="muted">暂无数据</p>'; return; }
   state.map=map; state.course=map.course||{}; state.selected=current||'';
   state.kps=flatten(map.stages||[],[]);
   const unlocked=state.kps.filter(function(k){return k.accessible;}), locked=state.kps.filter(function(k){return !k.accessible;});
   rootSub.textContent=(state.course.course_name||'')+(state.course.current_topic_label?(' · 当前进度：'+state.course.current_topic_label):'');
   const stages=map.stages||[], prog=map.student_progress||{};
   function nodeHtml(n,level){
     const p=prog[n.name]||{}; const total=Number(p.homework_total)||0, pass=Number(p.homework_pass)||0;
     const pct=total?Math.round(pass/total*100):0;
     const cls=n.accessible?(pct>=100?'done':'doing'):'locked';
     const status=n.accessible?(pct>=100?'已完成':'进行中'):'未解锁';
     const color=cls==='done'?'#67c23a':cls==='doing'?'#0a84ff':'#909399';
     return '<div class="node '+cls+(n.name===state.selected?' selected':'')+'" data-kp="'+esc(n.name)+'"><div class="t1">'+(level===1?'一级 ':'二级 ')+esc(n.label)+'</div><div class="meta">'+status+' · '+pass+'/'+total+' · '+pct+'%</div><div class="bar2"><i style="width:'+pct+'%;background:'+color+'"></i></div></div>';
   }
   let mh='<div class="cols">';
   stages.forEach(function(s){
     mh+='<div class="col">'+nodeHtml(s,1);
     const kids=Array.isArray(s.children)?s.children:[];
     if(kids.length){ mh+='<div class="children">'; kids.forEach(function(c){ mh+=nodeHtml(c,2); }); mh+='</div>'; }
     mh+='</div>';
   });
   mh+='</div>';
   mapwrap.innerHTML=mh;
   mapwrap.querySelectorAll('[data-kp]').forEach(function(el){ el.addEventListener('click',function(){ selectKp(el.getAttribute('data-kp')); }); });
   let h='<span class="badge ok">已解锁 '+unlocked.length+'</span><div class="chipwrap">';
   unlocked.forEach(function(k){ h+='<span class="chip unlocked'+(k.name===state.selected?' active':'')+'" data-kp="'+esc(k.name)+'">'+esc(k.label)+'</span>'; });
   h+='</div><span class="badge lock">待解锁 '+locked.length+'</span><div class="chipwrap">';
   locked.forEach(function(k){ h+='<span class="chip locked'+(k.name===state.selected?' active':'')+'" data-kp="'+esc(k.name)+'">'+esc(k.label)+'</span>'; });
   h+='</div>';
   progressEl.innerHTML=h;
   progressEl.querySelectorAll('.chip').forEach(function(c){ c.addEventListener('click',function(){ selectKp(c.getAttribute('data-kp')); }); });
   highlight();
 }
 function highlight(){ document.querySelectorAll('[data-kp]').forEach(function(c){ c.classList.toggle('active', c.getAttribute('data-kp')===state.selected); c.classList.toggle('selected', c.classList.contains('node') && c.getAttribute('data-kp')===state.selected); }); }
 function selectKp(kp){ if(!kp||kp===state.selected) return; state.selected=kp; highlight(); kpnameEl.textContent=(findKp(kp)||{}).label||kp; radarEl.innerHTML='<p class="muted">加载中…</p>'; metricsEl.innerHTML=''; vscode.postMessage({type:'knowledge', kpId:kp}); }
 function findKp(kp){ return state.kps.find(function(k){return k.name===kp;}); }
 function renderKnowledge(kpId,data){
   const prof=(data&&data.capability_profile)||{}; const meta=(data&&data.capability_metadata)||{};
   const kp=findKp(kpId)||{}; kpnameEl.textContent=kp.label||kpId;
   const labels=DIMS.map(function(d){ return d+((meta[d]&&meta[d].status==='insufficient')?'（待积累）':''); });
   radarEl.innerHTML=radar(labels, DIMS.map(function(d){return Number(prof[d])||0;}), '#0a84ff');
   let h='';
   DIMS.forEach(function(d){
     const m=meta[d]||{}; const v=Number(prof[d])||0; const enough=m.status!=='insufficient';
     h+='<div class="metric"><div class="dim">'+esc(d)+'</div><div class="score">'+(enough?Math.round(v*100)+' 分':'数据不足')+'</div><div class="samp">'+(m.sample_size!=null?m.sample_size:0)+'/'+(m.minimum_samples!=null?m.minimum_samples:0)+' 个有效样本</div><div class="samp">'+esc(m.message||'')+'</div></div>';
   });
   metricsEl.innerHTML=h;
 }
 window.addEventListener('message',function(e){ const m=e.data;
   if(m.type==='map'){ renderMap(m.data,m.current); }
   else if(m.type==='knowledge'){ renderKnowledge(m.kpId,m.data); }
   else if(m.type==='knowledgeLoading'){ kpnameEl.textContent=(findKp(m.kpId)||{}).label||m.kpId; radarEl.innerHTML='<p class="muted">加载中…</p>'; metricsEl.innerHTML=''; highlight(); }
   else if(m.type==='knowledgeError'){ radarEl.innerHTML='<p class="muted">加载失败：'+esc(m.text)+'</p>'; metricsEl.innerHTML=''; }
   else if(m.type==='loading'){ rootSub.textContent='加载中…'; }
   else if(m.type==='error'){ progressEl.innerHTML='<p class="muted">加载失败：'+esc(m.text)+'</p>'; }
 });
 vscode.postMessage({type:'ready'});
</script></body></html>`;
  }
}