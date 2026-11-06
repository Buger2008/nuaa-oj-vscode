import * as vscode from 'vscode';

export interface SettingsHost {
  getInfo(): any;
  saveInfo(fields: any): Promise<any>;
  changePassword(oldPassword: string, newPassword: string): Promise<any>;
  sendEmailCode(email: string): Promise<any>;
  changeEmail(password: string, newEmail: string, code: string): Promise<any>;
  uploadAvatar(dataUrl: string): Promise<any>;
}

export class SettingsPanel {
  private static current: SettingsPanel | undefined;
  private disposables: vscode.Disposable[] = [];

  static async show(host: SettingsHost, extensionUri: vscode.Uri): Promise<void> {
    if (SettingsPanel.current) {
      SettingsPanel.current.panel.reveal(vscode.ViewColumn.Active, false);
      return;
    }
    const panel = vscode.window.createWebviewPanel('nuaaOjSettings', 'NUAA OJ 设置', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    const p = new SettingsPanel(panel, host, extensionUri);
    SettingsPanel.current = p;
    panel.onDidDispose(() => {
      SettingsPanel.current = undefined;
      while (p.disposables.length) { try { p.disposables.pop()?.dispose(); } catch { /* ignore */ } }
    });
  }

  private constructor(private panel: vscode.WebviewPanel, private host: SettingsHost, private extensionUri: vscode.Uri) {
    this.panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources')] };
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage(async (m) => {
      const ok = (msg: string) => this.post({ type: 'result', ok: true, msg });
      const fail = (e: any) => this.post({ type: 'result', ok: false, msg: e?.message ?? String(e) });
      try {
        if (m?.type === 'ready') {
          this.post({ type: 'info', info: this.host.getInfo() });
        } else if (m?.type === 'saveInfo') {
          const info = await this.host.saveInfo(m.fields || {});
          this.post({ type: 'info', info });
          ok('资料已保存。');
        } else if (m?.type === 'changePassword') {
          if (!m.oldPassword || !m.newPassword) return fail('密码不能为空');
          if (m.newPassword !== m.againPassword) return fail('两次新密码不一致');
          await this.host.changePassword(m.oldPassword, m.newPassword);
          ok('密码修改成功。');
        } else if (m?.type === 'sendEmailCode') {
          if (!m.email) return fail('请先填写新邮箱');
          await this.host.sendEmailCode(m.email);
          ok('验证码已发送到新邮箱，请查收（10 分钟内有效）。');
        } else if (m?.type === 'changeEmail') {
          if (!m.email || !m.code || !m.password) return fail('新邮箱、验证码、当前密码不能为空');
          const info = await this.host.changeEmail(m.password, m.email, m.code);
          if (info) this.post({ type: 'info', info });
          ok('邮箱修改成功。');
        } else if (m?.type === 'uploadAvatar') {
          const url = await this.host.uploadAvatar(String(m.dataUrl || ''));
          this.post({ type: 'avatar', url });
          ok('头像已更新。');
        }
      } catch (e: any) {
        fail(e);
      }
    }, null, this.disposables);
  }

  private post(msg: any): void {
    try { void this.panel.webview.postMessage(msg); } catch { /* ignore */ }
  }

  private html(): string {
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src * data:; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
 body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:16px 22px;font-size:13px;}
 h1{font-size:18px;margin:0 0 12px;}
 h2{font-size:14px;margin:22px 0 10px;border-left:3px solid var(--vscode-focusBorder);padding-left:8px;}
 .grid{display:grid;grid-template-columns:130px 1fr;gap:10px 12px;align-items:center;max-width:720px;}
 .grid label{color:var(--vscode-descriptionForeground);text-align:right;}
 input,select,textarea{font-family:inherit;font-size:13px;padding:6px 8px;border-radius:4px;border:1px solid var(--vscode-input-border,var(--vscode-panel-border));background:var(--vscode-input-background);color:var(--vscode-input-foreground);width:100%;box-sizing:border-box;}
 textarea{height:70px;resize:vertical;}
 .btn{font-family:inherit;font-size:13px;padding:6px 16px;border-radius:4px;border:1px solid transparent;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer;}
 .btn.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);}
 .row{display:flex;gap:8px;align-items:center;}
 .avatar{width:72px;height:72px;border-radius:50%;object-fit:cover;border:1px solid var(--vscode-panel-border);background:rgba(127,127,127,.15);}
 .notice{padding:8px 12px;border-radius:6px;margin:10px 0;display:none;}
 .notice.ok{display:block;background:rgba(103,194,58,.18);color:#67c23a;}
 .notice.err{display:block;background:rgba(245,108,108,.18);color:#f56c6c;}
 .hint{color:var(--vscode-descriptionForeground);font-size:11.5px;margin:4px 0 0 142px;}
</style></head><body>
<h1>设置</h1>
<div class="notice" id="notice"></div>

<h2>资料设置</h2>
<div class="grid">
  <label>头像</label><div class="row"><img class="avatar" id="avatar"/><input type="file" id="avatarFile" accept="image/*" style="width:auto"/></div>
  <label>真实姓名</label><input id="realname"/>
  <label>昵称</label><input id="nickname"/>
  <label>学校</label><input id="school"/>
  <label>学号</label><input id="number"/>
  <label>Codeforces 用户名</label><input id="cfUsername"/>
  <label>博客</label><input id="blog"/>
  <label>GitHub</label><input id="github"/>
  <label>性别</label><select id="gender"><option value="secrecy">保密</option><option value="male">男</option><option value="female">女</option></select>
  <label>个性签名</label><textarea id="signature"></textarea>
  <label></label><div><button class="btn" id="saveInfo">保存资料</button></div>
</div>

<h2>账号设置 · 修改密码</h2>
<div class="grid">
  <label>当前密码</label><input type="password" id="oldPassword"/>
  <label>新密码</label><input type="password" id="newPassword"/>
  <label>确认新密码</label><input type="password" id="againPassword"/>
  <label></label><div><button class="btn" id="btnPwd">修改密码</button></div>
</div>

<h2>账号设置 · 修改邮箱</h2>
<div class="grid">
  <label>当前邮箱</label><input id="curEmail" disabled/>
  <label>新邮箱</label><div class="row"><input id="newEmail"/><button class="btn sec" id="btnSendCode" style="white-space:nowrap">发送验证码</button></div>
  <label>验证码</label><input id="code" maxlength="6"/>
  <label>当前密码</label><input type="password" id="emailPassword"/>
  <label></label><div><button class="btn" id="btnEmail">更新邮箱</button></div>
</div>
<div class="hint">验证码由 OJ 服务器通过邮件发送，绑定到新邮箱，10 分钟内有效；连续输错多次会临时锁定。</div>

<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 const $ = function(id){ return document.getElementById(id); };
 const notice = $('notice');
 function show(ok,msg){ notice.className='notice '+(ok?'ok':'err'); notice.textContent=msg; }
 function fill(info){
   if(!info) return;
   var map={realname:'realname',nickname:'nickname',school:'school',number:'number',cfUsername:'cfUsername',blog:'blog',github:'github',signature:'signature'};
   Object.keys(map).forEach(function(k){ var el=$(map[k]); if(el) el.value=info[k]||''; });
   $('gender').value=info.gender||'secrecy';
   $('curEmail').value=info.email||'';
   if(info.avatar) $('avatar').src=info.avatar;
 }
 $('saveInfo').addEventListener('click',function(){
   var f={realname:$('realname').value.trim(),nickname:$('nickname').value.trim(),school:$('school').value.trim(),number:$('number').value.trim(),cfUsername:$('cfUsername').value.trim(),blog:$('blog').value.trim(),github:$('github').value.trim(),gender:$('gender').value||'secrecy',signature:$('signature').value};
   vscode.postMessage({type:'saveInfo', fields:f});
 });
 $('btnPwd').addEventListener('click',function(){ vscode.postMessage({type:'changePassword', oldPassword:$('oldPassword').value, newPassword:$('newPassword').value, againPassword:$('againPassword').value}); });
 $('btnSendCode').addEventListener('click',function(){ vscode.postMessage({type:'sendEmailCode', email:$('newEmail').value.trim()}); });
 $('btnEmail').addEventListener('click',function(){ vscode.postMessage({type:'changeEmail', password:$('emailPassword').value, email:$('newEmail').value.trim(), code:$('code').value.trim()}); });
 $('avatarFile').addEventListener('change',function(e){ var file=e.target.files&&e.target.files[0]; if(!file) return; var r=new FileReader(); r.onload=function(){ vscode.postMessage({type:'uploadAvatar', dataUrl:r.result}); }; r.readAsDataURL(file); });
 window.addEventListener('message',function(e){ var m=e.data;
   if(m.type==='info'){ fill(m.info); }
   else if(m.type==='avatar'){ if(m.url) $('avatar').src=m.url; }
   else if(m.type==='result'){ show(m.ok, m.msg); }
 });
 vscode.postMessage({type:'ready'});
</script></body></html>`;
  }
}
