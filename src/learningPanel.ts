import * as vscode from 'vscode';

export interface LearningHost {
  data(): Promise<any>;
  openAssistantGeneral(): void;
  openProfile(): void;
}

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class LearningPanel {
  private static current: LearningPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  static async show(host: LearningHost, extensionUri: vscode.Uri): Promise<void> {
    if (LearningPanel.current) {
      LearningPanel.current.panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }
    const panel = vscode.window.createWebviewPanel('nuaaOjLearning', '学径', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const p = new LearningPanel(panel, host, extensionUri);
    LearningPanel.current = p;
    panel.onDidDispose(() => {
      LearningPanel.current = undefined;
      while (p.disposables.length) { try { p.disposables.pop()?.dispose(); } catch { /* ignore */ } }
    });
  }

  private constructor(private panel: vscode.WebviewPanel, private host: LearningHost, private extensionUri: vscode.Uri) {
    this.panel.webview.options = { enableScripts: true };
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage(async (m) => {
      if (m?.type === 'ready') await this.load();
      else if (m?.type === 'refresh') await this.load();
      else if (m?.type === 'openAssistant') this.host.openAssistantGeneral();
      else if (m?.type === 'openProfile') this.host.openProfile();
    }, null, this.disposables);
  }

  private post(msg: any): void { try { void this.panel.webview.postMessage(msg); } catch { /* ignore */ } }

  private async load(): Promise<void> {
    this.post({ type: 'loading' });
    try {
      const data = await this.host.data();
      this.post({ type: 'data', data });
    } catch (e: any) {
      this.post({ type: 'error', text: e?.message ?? String(e) });
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
 h2{font-size:14px;margin:18px 0 8px;border-left:3px solid var(--vscode-focusBorder);padding-left:8px;}
 .muted{color:var(--vscode-descriptionForeground);font-size:12px;}
 .bar-actions{display:flex;gap:8px;margin:8px 0 2px;flex-wrap:wrap;}
 .btn{font-family:inherit;font-size:12.5px;padding:6px 12px;border-radius:4px;border:1px solid transparent;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;}
 .btn.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);}
 .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:6px 0 4px;}
 .card{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:10px;}
 .card .n{font-size:20px;font-weight:700;} .card .l{font-size:12px;color:var(--vscode-descriptionForeground);}
 .chart{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px 10px;margin-bottom:10px;}
 .row{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12.5px;}
 .row .name{width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .row .bar{flex:1;height:11px;border-radius:6px;background:rgba(127,127,127,.2);overflow:hidden;}
 .row .bar i{display:block;height:100%;border-radius:6px;}
 .row .v{width:44px;text-align:right;color:var(--vscode-descriptionForeground);}
 .kp{padding:8px 10px;border:1px solid var(--vscode-panel-border);border-radius:8px;margin:8px 0;}
 .kp>summary{cursor:pointer;display:flex;align-items:center;gap:8px;list-style:none;}
 .kp>summary::-webkit-details-marker{display:none;}
 .locked{color:var(--vscode-descriptionForeground);}
 .tag{font-size:11px;padding:1px 6px;border-radius:8px;color:#fff;}
 .tag.open{background:#67c23a;} .tag.lock{background:#909399;}
 .notice{padding:6px 10px;border-radius:6px;background:rgba(127,127,127,.12);color:var(--vscode-descriptionForeground);margin-top:10px;}
</style></head><body>
<h1>学径</h1>
<div class="muted" id="sub">加载中…</div>
<div class="bar-actions">
  <button class="btn" id="btn-ai">🤖 叽咕助教</button>
  <button class="btn sec" id="btn-profile">📊 能力画像</button>
  <button class="btn sec" id="btn-refresh">刷新</button>
</div>
<div id="root"></div>
<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 const root=document.getElementById('root'), sub=document.getElementById('sub');
 document.getElementById('btn-ai').addEventListener('click',()=>vscode.postMessage({type:'openAssistant'}));
 document.getElementById('btn-profile').addEventListener('click',()=>vscode.postMessage({type:'openProfile'}));
 document.getElementById('btn-refresh').addEventListener('click',()=>vscode.postMessage({type:'refresh'}));
 function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
 function render(data){
   const ov=data&&data.overview; const map=ov&&ov.map; if(!map){ root.innerHTML='<p class="muted">暂无学习数据</p>'; return; }
   const course=map.course||{}; const stages=map.stages||[]; const prog=map.student_progress||{};
   sub.textContent=(course.course_name||'')+(course.current_topic_label?(' · 当前进度：'+course.current_topic_label):'');
   const accessible=stages.filter(function(s){return s.accessible;}).length;
   const weak=ov&&ov.weak_point_count!=null?ov.weak_point_count:'-';
   const rec=ov&&ov.recommendation_count!=null?ov.recommendation_count:'-';
   let h='<h2>概览</h2><div class="cards">';
   h+='<div class="card"><div class="n">'+esc(course.current_topic_label||'-')+'</div><div class="l">当前进度</div></div>';
   h+='<div class="card"><div class="n">'+accessible+' / '+stages.length+'</div><div class="l">已解锁知识点</div></div>';
   h+='<div class="card"><div class="n">'+esc(weak)+'</div><div class="l">薄弱知识点</div></div>';
   h+='<div class="card"><div class="n">'+esc(rec)+'</div><div class="l">推荐资源</div></div>';
   h+='</div>';
   // 学习地图：按教学顺序的掌握度条形图
   h+='<h2>学习地图 · 掌握度</h2><div class="chart">';
   stages.forEach(function(s){
     const p=prog[s.name]||{}; const pass=Number(p.homework_pass)||0, total=Number(p.homework_total)||0;
     const pct= total? Math.round(pass/total*100) : 0;
     const color=s.accessible? '#0a84ff' : '#909399';
     h+='<div class="row"><span class="name" title="'+esc(s.label)+'">'+esc(s.label)+'</span><div class="bar"><i style="width:'+pct+'%;background:'+color+'"></i></div><span class="v">'+pct+'%</span></div>';
   });
   h+='</div>';
   // 知识点列表（可展开）
   h+='<h2>知识点</h2>';
   stages.forEach(function(s){
     const p=prog[s.name]||{}; const total=Number(p.homework_total)||0, pass=Number(p.homework_pass)||0;
     h+='<details class="kp"><summary><span class="tag '+(s.accessible?'open':'lock')+'">'+(s.accessible?'已解锁':'未解锁')+'</span><span style="flex:1;font-weight:600">'+esc(s.label)+'</span><span class="muted">作业 '+pass+'/'+total+'</span></summary><div style="padding:6px 0 0 24px">';
     const children=Array.isArray(s.children)?s.children:[];
     if(!children.length){ h+='<div class="muted">暂无子知识点</div>'; }
     children.forEach(function(c){
       const cp=prog[c.name]||{}; const ct=Number(cp.homework_total)||0, cpass=Number(cp.homework_pass)||0;
       h+='<div class="row"><span class="name" style="width:150px">'+esc(c.label)+'</span><div class="bar"><i style="width:'+(ct?Math.round(cpass/ct*100):0)+'%;background:'+(c.accessible?'#67c23a':'#909399')+'"></i></div><span class="v">'+(ct?Math.round(cpass/ct*100):0)+'%</span></div>';
     });
     h+='</div></details>';
   });
   h+='<div class="notice">推荐学习资源暂未开发。</div>';
   root.innerHTML=h;
 }
 window.addEventListener('message',function(e){ const m=e.data;
   if(m.type==='data'){ render(m.data); }
   else if(m.type==='loading'){ root.innerHTML='<p class="muted">加载中…</p>'; }
   else if(m.type==='error'){ root.innerHTML='<p class="muted">加载失败：'+esc(m.text)+'</p>'; }
 });
 vscode.postMessage({type:'ready'});
</script></body></html>`;
  }
}