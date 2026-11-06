import * as vscode from 'vscode';
import { ProblemContext } from './context';

export interface AssistantHost {
  getContext(ctx: ProblemContext): Promise<any>;
  getSessions(): Promise<any[]>;
  getSession(sessionId: string): Promise<any[]>;
  ask(ctx: ProblemContext, question: string, sessionId: string, onEvent: (ev: any) => void, signal: AbortSignal): Promise<void>;
  openExternal(url: string): void;
}

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class AssistantPanel {
  private static map = new Map<string, AssistantPanel>();
  private disposables: vscode.Disposable[] = [];
  private messages: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  private sessions: any[] = [];
  private sessionId = '';
  private streaming = false;
  private controller: AbortController | undefined;
  private contextInfo: any = null;

  static key(ctx: ProblemContext): string {
    return `${ctx.kind}:${ctx.tid ?? 0}:${ctx.displayId}`;
  }

  static async show(ctx: ProblemContext, host: AssistantHost, extensionUri: vscode.Uri): Promise<void> {
    const key = AssistantPanel.key(ctx);
    const existing = AssistantPanel.map.get(key);
    if (existing) {
      existing.ctx = ctx;
      existing.panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }
    const panel = vscode.window.createWebviewPanel('nuaaOjAssistant', `AI 助手 · ${ctx.displayId}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const p = new AssistantPanel(panel, ctx, host, extensionUri);
    AssistantPanel.map.set(key, p);
    panel.onDidDispose(() => {
      AssistantPanel.map.delete(key);
      p.controller?.abort();
      while (p.disposables.length) {
        try { p.disposables.pop()?.dispose(); } catch { /* ignore */ }
      }
    });
    await p.init();
  }

  private constructor(
    private panel: vscode.WebviewPanel,
    private ctx: ProblemContext,
    private host: AssistantHost,
    private extensionUri: vscode.Uri,
  ) {
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources')],
    };
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage(async (m) => {
      try {
        await this.onMessage(m);
      } catch (e: any) {
        this.post({ type: 'error', text: e?.message ?? String(e) });
      }
    }, null, this.disposables);
  }

  private post(msg: any): void {
    try { void this.panel.webview.postMessage(msg); } catch { /* disposed */ }
  }

  private async init(): Promise<void> {
    this.post({ type: 'init', ctx: { problemId: this.ctx.displayId, title: this.ctx.title }, sessionId: this.sessionId });
    try {
      this.contextInfo = await this.host.getContext(this.ctx);
      this.post({
        type: 'context',
        latest: this.contextInfo?.latest_submission || null,
        latestAvailable: !!this.contextInfo?.latest_submission_available,
      });
    } catch (e: any) {
      this.post({ type: 'context', error: e?.message ?? String(e) });
    }
    await this.loadSessions();
  }

  private async loadSessions(): Promise<void> {
    try {
      this.sessions = await this.host.getSessions();
      this.post({ type: 'sessions', list: this.sessions });
    } catch { /* ignore */ }
  }

  private async onMessage(m: any): Promise<void> {
    switch (m?.type) {
      case 'ready':
        this.post({ type: 'messages', messages: this.messages });
        break;
      case 'ask':
        await this.ask(String(m.question ?? ''));
        break;
      case 'newSession':
        this.sessionId = '';
        this.messages = [];
        this.post({ type: 'messages', messages: this.messages });
        break;
      case 'loadSession':
        await this.loadSession(String(m.sessionId));
        break;
      case 'listSessions':
        await this.loadSessions();
        break;
      case 'cancel':
        this.controller?.abort();
        break;
    }
  }

  private async loadSession(sessionId: string): Promise<void> {
    try {
      const rounds = await this.host.getSession(sessionId);
      const msgs: Array<{ role: 'user' | 'assistant'; text: string }> = [];
      for (const r of rounds || []) {
        if (r?.ask) msgs.push({ role: 'user', text: String(r.ask) });
        if (r?.reply) msgs.push({ role: 'assistant', text: String(r.reply) });
      }
      this.messages = msgs;
      this.sessionId = sessionId;
      this.post({ type: 'messages', messages: this.messages, sessionId });
    } catch (e: any) {
      this.post({ type: 'error', text: `加载会话失败：${e?.message ?? e}` });
    }
  }

  private async ask(question: string): Promise<void> {
    const q = question.trim();
    if (!q || this.streaming) return;
    this.messages.push({ role: 'user', text: q });
    this.messages.push({ role: 'assistant', text: '' });
    this.streaming = true;
    this.post({ type: 'assistantStart' });
    this.controller = new AbortController();
    try {
      await this.host.ask(this.ctx, q, this.sessionId, (ev) => {
        if (ev && typeof ev.t === 'string') {
          const last = this.messages[this.messages.length - 1];
          last.text += ev.t;
          this.post({ type: 'chunk', text: ev.t });
        } else if (ev && ev.meta) {
          if (ev.meta.session_id) this.sessionId = String(ev.meta.session_id);
          if (ev.meta.mode) this.post({ type: 'mode', mode: String(ev.meta.mode) });
        } else if (ev && ev.session_id) {
          this.sessionId = String(ev.session_id);
        }
      }, this.controller.signal);
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        const last = this.messages[this.messages.length - 1];
        if (last && last.role === 'assistant' && !last.text) last.text = `（出错：${e?.message ?? e}）`;
        this.post({ type: 'error', text: e?.message ?? String(e) });
      }
    } finally {
      this.streaming = false;
      this.post({ type: 'done', sessionId: this.sessionId });
      void this.loadSessions();
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
 body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;height:100vh;display:flex;flex-direction:column;}
 header{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--vscode-panel-border);}
 header .title{font-weight:700;font-size:14px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 button{font-family:inherit;font-size:12.5px;padding:5px 10px;border-radius:4px;border:1px solid transparent;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer;}
 button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
 .ctxbar{padding:6px 12px;font-size:12px;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-panel-border);}
 .ctxbar b{color:var(--vscode-foreground);}
 #sessions{display:none;padding:8px 12px;border-bottom:1px solid var(--vscode-panel-border);max-height:32vh;overflow:auto;}
 #sessions.show{display:block;}
 .sess{padding:6px 8px;border-radius:4px;cursor:pointer;font-size:12.5px;display:flex;gap:8px;align-items:center;}
 .sess:hover{background:rgba(127,127,127,.15);}
 .sess .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
 .sess .m{font-size:11px;color:var(--vscode-descriptionForeground);}
 #msgs{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px;}
 .msg{max-width:86%;padding:9px 12px;border-radius:10px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}
 .msg.user{align-self:flex-end;background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
 .msg.assistant{align-self:flex-start;background:rgba(127,127,127,.16);}
 .msg.assistant.streaming::after{content:'▋';opacity:.6;margin-left:2px;}
 .msg.md{white-space:normal;}
 .msg.md p{margin:6px 0;} .msg.md p:first-child{margin-top:0;} .msg.md p:last-child{margin-bottom:0;}
 .msg.md code{font-family:var(--vscode-editor-font-family,monospace);background:rgba(127,127,127,.25);padding:1px 4px;border-radius:3px;font-size:12px;}
 .msg.md pre{background:var(--vscode-textCodeBlock-background,rgba(127,127,127,.25));padding:8px 10px;border-radius:6px;overflow:auto;margin:6px 0;}
 .msg.md pre code{background:none;padding:0;}
 .msg.md ul,.msg.md ol{margin:6px 0;padding-left:20px;}
 .msg.md h1,.msg.md h2,.msg.md h3{font-size:13.5px;margin:8px 0 4px;}
 .msg.md a{color:var(--vscode-textLink-foreground);}
 .composer{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--vscode-panel-border);}
 textarea{flex:1;resize:none;height:60px;font-family:inherit;font-size:13px;padding:8px;border-radius:6px;border:1px solid var(--vscode-input-border,var(--vscode-panel-border));background:var(--vscode-input-background);color:var(--vscode-input-foreground);}
 .hint{font-size:11px;color:var(--vscode-descriptionForeground);padding:0 12px 6px;}
</style></head><body>
<header>
 <span class="title" id="title">AI 助手</span>
 <button id="btn-new">新建</button>
 <button id="btn-hist">历史会话</button>
</header>
<div class="ctxbar" id="ctxbar">正在加载题目上下文…</div>
<div id="sessions"></div>
<div id="msgs"></div>
<div class="hint">Enter 发送，Shift+Enter 换行。AI 可能会出错，请自行判断。</div>
<div class="composer">
 <textarea id="input" placeholder="向 AI 助教提问，例如：这道题该怎么入手？"></textarea>
 <button class="primary" id="btn-send">发送</button>
</div>
<script nonce="${nonce}" src="${mdUri}"></script>
<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 const msgsEl = document.getElementById('msgs');
 const sessionsEl = document.getElementById('sessions');
 const ctxbar = document.getElementById('ctxbar');
 let state = { messages: [], streaming: false, sessionId: '', problemId: '' };
 const md = (window.markdownit ? window.markdownit({breaks:true, linkify:true}) : null);

 function renderMsg(m){
   const d=document.createElement('div');
   d.className='msg '+m.role;
   if(state.streaming && m.role==='assistant' && !m.final) d.classList.add('streaming');
   if(m.role==='assistant' && m.final && md){ d.classList.add('md'); d.innerHTML=md.render(m.text||''); }
   else if(m.role==='assistant'){ d.textContent=(m.text||'').slice(0, m.shown||0); }
   else { d.textContent=m.text||''; }
   return d;
 }
 function renderMsgs(){
   msgsEl.innerHTML='';
   state.messages.forEach(function(m){ msgsEl.appendChild(renderMsg(m)); });
   msgsEl.scrollTop = msgsEl.scrollHeight;
 }
 function tick(){
   let changed=false;
   state.messages.forEach(function(m){
     if(m.role==='assistant' && !m.final){
       const len=(m.text||'').length;
       if((m.shown||0)<len){ m.shown=Math.min(len,(m.shown||0)+Math.max(1,Math.ceil((len-(m.shown||0))*0.18))); changed=true; }
       else if(!state.streaming){ m.final=true; changed=true; }
     }
   });
   if(changed) renderMsgs();
 }
 setInterval(tick, 40);
 function renderSessions(list){
   sessionsEl.innerHTML='';
   if(!list || !list.length){ sessionsEl.appendChild(document.createTextNode('暂无历史会话')); return; }
   list.forEach(function(s){
     const d=document.createElement('div'); d.className='sess';
     const t=document.createElement('span'); t.className='t'; t.textContent=s.title||'(无标题)';
     const m=document.createElement('span'); m.className='m'; m.textContent=(s.last_time||'')+' · '+(s.count||0)+'条';
     d.appendChild(t); d.appendChild(m);
     d.addEventListener('click',function(){ vscode.postMessage({type:'loadSession', sessionId:s.session_id}); sessionsEl.classList.remove('show'); });
     sessionsEl.appendChild(d);
   });
 }
 function send(){
   const inp=document.getElementById('input');
   const q=inp.value.trim(); if(!q || state.streaming) return;
   inp.value='';
   state.messages.push({role:'user',text:q});
   state.messages.push({role:'assistant',text:'',shown:0,final:false});
   state.streaming=true; renderMsgs();
   vscode.postMessage({type:'ask', question:q});
 }
 document.getElementById('btn-send').addEventListener('click',send);
 document.getElementById('input').addEventListener('keydown',function(e){ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); send(); } });
 document.getElementById('btn-new').addEventListener('click',function(){ state.messages=[]; state.sessionId=''; state.streaming=false; renderMsgs(); vscode.postMessage({type:'newSession'}); });
 document.getElementById('btn-hist').addEventListener('click',function(){ sessionsEl.classList.toggle('show'); if(sessionsEl.classList.contains('show')) vscode.postMessage({type:'listSessions'}); });

 window.addEventListener('message',function(e){ const m=e.data;
   if(m.type==='init'){ state.problemId=m.ctx.problemId; document.getElementById('title').textContent = m.ctx.problemId ? ('AI 助手 · '+m.ctx.problemId+' '+(m.ctx.title||'')) : 'AI 助手（通用）'; }
   else if(m.type==='context'){ if(!state.problemId){ ctxbar.textContent='通用 AI 助手 · 可直接提问任何编程问题'; } else if(m.error){ ctxbar.textContent='上下文加载失败：'+m.error; } else { let s='题目已载入'; if(m.latest){ s+=' · 最近提交 #'+m.latest.submit_id+' '+(m.latest.status_name||''); } else if(!m.latestAvailable){ s+=' · 暂无提交记录'; } ctxbar.textContent=s; } }
   else if(m.type==='messages'){ state.messages=(m.messages||[]).map(function(x){ return {role:x.role, text:x.text, shown:(x.text||'').length, final:true}; }); state.streaming=false; if(m.sessionId) state.sessionId=m.sessionId; renderMsgs(); }
   else if(m.type==='assistantStart'){ state.streaming=true; const last=state.messages[state.messages.length-1]; if(!last||last.role!=='assistant'||last.final){ state.messages.push({role:'assistant',text:'',shown:0,final:false}); } renderMsgs(); }
   else if(m.type==='chunk'){ state.streaming=true; const last=state.messages[state.messages.length-1]; if(last&&last.role==='assistant'){ last.text+=m.text; } renderMsgs(); }
   else if(m.type==='done'){ state.streaming=false; if(m.sessionId) state.sessionId=m.sessionId; renderMsgs(); }
   else if(m.type==='sessions'){ renderSessions(m.list); }
   else if(m.type==='error'){ state.streaming=false; const last=state.messages[state.messages.length-1]; if(last&&last.role==='assistant'&&!last.text){ last.text='（出错：'+m.text+'）'; last.shown=last.text.length; last.final=true; } renderMsgs(); }
 });
 vscode.postMessage({type:'ready'});
</script></body></html>`;
  }
}

