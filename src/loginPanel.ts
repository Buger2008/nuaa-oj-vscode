import * as vscode from 'vscode';
import { AuthManager } from './auth';
import { OjError } from './api';

function nonce(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

export class LoginPanel {
  private static current: LoginPanel | undefined;

  static show(auth: AuthManager, baseUrl: string, onSuccess: () => void): void {
    if (LoginPanel.current) {
      LoginPanel.current.panel.reveal(vscode.ViewColumn.Active, false);
      LoginPanel.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel('nuaaOjLogin', 'NUAA OJ 登录', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    LoginPanel.current = new LoginPanel(panel, auth, baseUrl, onSuccess);
  }

  private disposables: vscode.Disposable[] = [];

  private constructor(
    private panel: vscode.WebviewPanel,
    private auth: AuthManager,
    private baseUrl: string,
    private onSuccess: () => void,
  ) {
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m), null, this.disposables);
    this.render();
  }

  private refresh(): void {
    this.render();
  }

  private currentUsername(): string {
    return vscode.workspace.getConfiguration('nuaaOj').get<string>('username', '') || '';
  }

  private render(): void {
    const n = nonce();
    const user = this.auth.currentUser;
    const prefill = user?.username || this.currentUsername();
    const loggedIn = !!user;
    this.panel.webview.html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
  body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);
       display:flex;justify-content:center;padding-top:8vh;}
  .card{width:360px;max-width:90vw;border:1px solid var(--vscode-panel-border);border-radius:10px;padding:26px 28px;background:var(--vscode-sideBar-background,rgba(127,127,127,.05));}
  h1{font-size:18px;margin:0 0 4px;}
  .sub{color:var(--vscode-descriptionForeground);font-size:12px;margin-bottom:20px;word-break:break-all;}
  label{display:block;font-size:12px;margin:12px 0 5px;color:var(--vscode-descriptionForeground);}
  input{width:100%;box-sizing:border-box;padding:8px 10px;font-size:13px;border-radius:5px;
        border:1px solid var(--vscode-input-border,var(--vscode-panel-border));background:var(--vscode-input-background);color:var(--vscode-input-foreground);}
  input:focus{outline:1px solid var(--vscode-focusBorder);}
  button{width:100%;margin-top:20px;padding:9px;font-size:14px;border:none;border-radius:5px;cursor:pointer;
         background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
  button:hover{background:var(--vscode-button-hoverBackground);}
  button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);margin-top:10px;}
  .msg{min-height:18px;margin-top:12px;font-size:12.5px;}
  .err{color:#f56c6c;} .ok{color:#67c23a;}
  .logged{font-size:13px;line-height:1.7;}
</style></head><body>
<div class="card">
  <h1>NUAA OJ 登录</h1>
  <div class="sub">${this.baseUrl}</div>
  ${loggedIn ? `
    <div class="logged">当前已登录：<b>${escapeHtml(user!.nickname || user!.username)}</b>（${escapeHtml(user!.username)}）</div>
    <button id="logout" class="secondary">退出登录</button>
  ` : `
    <form id="form">
      <label>用户名 / 学号</label>
      <input id="username" value="${escapeAttr(prefill)}" autocomplete="username" autofocus />
      <label>密码</label>
      <input id="password" type="password" autocomplete="current-password" />
      <button type="submit" id="submit">登录</button>
      <div class="msg" id="msg"></div>
    </form>
  `}
</div>
<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const $ = (id)=>document.getElementById(id);
  const msg = (t, cls)=>{ const m=$('msg'); if(m){ m.className='msg '+(cls||''); m.textContent=t; } };
  const form = $('form');
  if (form) {
    form.addEventListener('submit', (e)=>{
      e.preventDefault();
      const username=$('username').value.trim();
      const password=$('password').value;
      if(!username||!password){ msg('请输入用户名和密码','err'); return; }
      $('submit').disabled=true; msg('正在登录…','');
      vscode.postMessage({type:'login',username,password});
    });
  }
  const lo=$('logout'); if(lo) lo.addEventListener('click',()=>vscode.postMessage({type:'logout'}));
  window.addEventListener('message',(e)=>{
    const m=e.data;
    if(m.type==='result'){
      const s=$('submit'); if(s) s.disabled=false;
      if(m.ok){ msg('登录成功：'+(m.name||''),'ok'); }
      else { msg('登录失败：'+m.error,'err'); }
    }
  });
</script></body></html>`;
  }

  private async onMessage(m: any): Promise<void> {
    if (m?.type === 'login') {
      try {
        const user = await this.auth.login(String(m.username), String(m.password));
        await vscode.workspace.getConfiguration('nuaaOj').update('username', String(m.username), vscode.ConfigurationTarget.Global);
        this.panel.webview.postMessage({ type: 'result', ok: true, name: user.nickname || user.username });
        this.onSuccess();
        setTimeout(() => this.render(), 400);
      } catch (e: any) {
        const error = e instanceof OjError ? e.message : String(e?.message ?? e);
        this.panel.webview.postMessage({ type: 'result', ok: false, error });
      }
    } else if (m?.type === 'logout') {
      await this.auth.logout();
      this.onSuccess();
      this.render();
    }
  }

  private dispose(): void {
    LoginPanel.current = undefined;
    while (this.disposables.length) {
      try {
        this.disposables.pop()?.dispose();
      } catch {
        /* ignore */
      }
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
