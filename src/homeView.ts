import * as vscode from 'vscode';
import { AuthManager } from './auth';
import { UserInfo } from './types';

export interface HomeCallbacks {
  openProblem: (value: string) => Promise<void>;
  openLogin: () => void;
  logout: () => Promise<void>;
  onChange?: () => void;
}

function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function diffLabel(d: any): string {
  switch (Number(d)) {
    case 1: return '简单';
    case 2: return '中等';
    case 3: return '困难';
    default: return '未分类';
  }
}
function pctStr(n: any, t: number): string {
  if (!t) return '0%';
  return (((Number(n) || 0) / t) * 100).toFixed(2) + '%';
}
function statsTip(p: any): string {
  const t = Number(p.total) || 0;
  let s = '难度：' + diffLabel(p.difficulty);
  if (t > 0) {
    s += '\nAC ' + pctStr(p.ac, t) + '\nWA ' + pctStr(p.wa, t) + '\nTLE ' + pctStr(p.tle, t) + '\nMLE ' + pctStr(p.mle, t) +
      '\nRE ' + pctStr(p.re, t) + '\nPE ' + pctStr(p.pe, t) + '\nCE ' + pctStr(p.ce, t) + '\nSE ' + pctStr(p.se, t) + '\n共 ' + t + ' 次提交';
  } else {
    s += '\n暂无提交统计';
  }
  return s;
}
function probItemView(p: any) {
  return { id: p.problemId, title: p.title, difficulty: Number(p.difficulty) || 0, dlabel: diffLabel(p.difficulty), tip: statsTip(p), ac: false as boolean };
}

export class HomeViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'nuaaOjHome';
  private view: vscode.WebviewView | undefined;
  private problemsCache: any[] | undefined;
  private problemsKeyword = '';
  private trainingsCache: any[] | undefined;

  constructor(
    private auth: AuthManager,
    private extensionUri: vscode.Uri,
    private cb: HomeCallbacks,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage(async (m) => {
      try {
        await this.onMessage(m);
      } catch (e: any) {
        this.view?.webview.postMessage({ type: 'error', text: e?.message ?? String(e) });
      }
    });
  }

  refresh(): void {
    this.problemsCache = undefined;
    this.trainingsCache = undefined;
    this.postState();
    this.view?.webview.postMessage({ type: 'reload' });
  }

  postState(): void {
    if (!this.view) return;
    const u = this.auth.currentUser;
    this.view.webview.postMessage({ type: 'state', loggedIn: !!u, user: this.userBrief(u) });
  }

  focusSearch(): void {
    this.view?.show?.(true);
    this.view?.webview.postMessage({ type: 'focusSearch' });
  }

  private userBrief(u?: UserInfo): any {
    if (!u) return null;
    return { nickname: u.nickname || u.username, username: u.username, school: u.school || '', signature: u.signature || '', roles: u.roleList || [] };
  }

  private async onMessage(m: any): Promise<void> {
    switch (m?.type) {
      case 'ready':
        this.postState();
        break;
      case 'tab':
        await this.sendTab(m.tab, '');
        break;
      case 'search':
        await this.sendTab('problems', String(m.keyword ?? ''));
        break;
      case 'expandTraining':
        await this.sendTrainingProblems(Number(m.tid));
        break;
      case 'openProblem':
        await this.cb.openProblem(String(m.value));
        break;
      case 'login':
        this.cb.openLogin();
        break;
      case 'logout':
        await this.cb.logout();
        this.refresh();
        break;
      case 'refresh':
        this.refresh();
        break;
    }
  }

  private async sendTab(tab: string, keyword: string): Promise<void> {
    if (!this.view) return;
    if (tab === 'problems') {
      const data = await this.getProblems(keyword);
      this.view.webview.postMessage({ type: 'data', tab: 'problems', keyword, payload: data });
    } else if (tab === 'trainings') {
      const data = await this.getTrainings();
      this.view.webview.postMessage({ type: 'data', tab: 'trainings', payload: data });
    } else if (tab === 'homework') {
      const data = await this.getHomework();
      this.view.webview.postMessage({ type: 'data', tab: 'homework', payload: data });
    } else if (tab === 'my') {
      this.view.webview.postMessage({ type: 'data', tab: 'my', payload: this.userBrief(this.auth.currentUser) });
    }
  }

  private async getProblems(keyword: string): Promise<any> {
    if (!(await this.auth.ensureLoggedIn(false))) return { needLogin: true, items: [], total: 0 };
    if (this.problemsCache && keyword === this.problemsKeyword) return { items: this.problemsCache, total: this.problemsCache.length };
    try {
      const size = 500;
      let page = 1;
      let pages = 1;
      const all: any[] = [];
      do {
        const res = await this.auth.api.getProblemList({ currentPage: page, limit: size, keyword: keyword || undefined });
        all.push(...(res.records || []));
        pages = res.pages || 1;
        page++;
      } while (page <= pages && page <= 50);
      const acSet = await this.fetchAcSet(all.map((p: any) => p.pid));
      const items = all.map((p: any) => ({ id: p.problemId, title: p.title, difficulty: Number(p.difficulty) || 0, dlabel: diffLabel(p.difficulty), tip: statsTip(p), ac: acSet.has(Number(p.pid)) }));
      if (!keyword) {
        this.problemsCache = items;
        this.problemsKeyword = '';
      }
      return { items, total: items.length };
    } catch (e: any) {
      return { error: e?.message ?? String(e), items: [], total: 0 };
    }
  }

  private async fetchAcSet(pids: any[]): Promise<Set<number>> {
    const set = new Set<number>();
    const ids = Array.from(new Set(pids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)));
    const chunk = 300;
    for (let i = 0; i < ids.length; i += chunk) {
      try {
        const res = await this.auth.api.getUserProblemStatus(ids.slice(i, i + chunk));
        for (const k of Object.keys(res || {})) {
          const v: any = (res as any)[k];
          const st = v && typeof v === 'object' ? v.status : v;
          if (Number(st) === 0) set.add(Number(k));
        }
      } catch {
        /* ignore */
      }
    }
    return set;
  }

  private async getTrainings(): Promise<any> {
    if (!(await this.auth.ensureLoggedIn(false))) return { needLogin: true, items: [] };
    if (this.trainingsCache) return { items: this.trainingsCache };
    try {
      const page = await this.auth.api.getTrainingList({ currentPage: 1, limit: 500 });
      const items = (page.records || []).map((t: any) => ({ tid: t.id, title: t.title, count: t.problemCount, category: t.categoryName || '' }));
      this.trainingsCache = items;
      return { items };
    } catch (e: any) {
      return { error: e?.message ?? String(e), items: [] };
    }
  }

  private async sendTrainingProblems(tid: number): Promise<void> {
    if (!this.view) return;
    try {
      const probs = await this.auth.api.getTrainingProblemList(tid);
      const acSet = await this.fetchAcSet(probs.map((p: any) => p.pid));
      const items = probs.map((p: any) => ({ id: p.problemId, title: p.title, difficulty: Number(p.difficulty) || 0, dlabel: diffLabel(p.difficulty), tip: statsTip(p), ac: acSet.has(Number(p.pid)), value: `training/${tid}/problem/${p.problemId}` }));
      this.view.webview.postMessage({ type: 'trainingProblems', tid, items });
    } catch (e: any) {
      this.view.webview.postMessage({ type: 'trainingProblems', tid, error: e?.message ?? String(e), items: [] });
    }
  }

  private async getHomework(): Promise<any> {
    if (!(await this.auth.ensureLoggedIn(false))) return { needLogin: true, chapters: [] };
    try {
      const u: any = this.auth.currentUser;
      const uid = vscode.workspace.getConfiguration('nuaaOj').get<string>('recommendation.userId', '') || u?.username || '';
      if (!uid) return { chapters: [] };
      const d = await this.auth.api.getLearningMap(uid);
      const kp = d?.knowledge_problems || {};
      const prog = d?.student_progress || {};
      const current = d?.course?.current_topic;
      const stages: any[] = Array.isArray(d?.stages) ? d.stages : [];
      const chapters: any[] = [];
      const seen = new Set<string>();
      const mapProb = (p: any) => ({ id: p.problem_id, title: p.title, ac: !!p.ac, attempted: !!p.attempted });
      const add = (name: string, label: string, hw: any[], pr: any[]) => {
        const pp = prog[name] || {};
        chapters.push({
          label,
          current: current === name,
          pass: pp.homework_pass ?? hw.filter((x: any) => x.ac).length,
          total: pp.homework_total ?? hw.length,
          homework: hw.map(mapProb),
          practice: pr.map(mapProb),
        });
      };
      for (const st of stages) {
        const name = st?.name || st?.id;
        if (!name || seen.has(name)) continue;
        const hw = (kp[name]?.homework as any[]) || [];
        const pr = (kp[name]?.practice as any[]) || [];
        if (!hw.length && !pr.length) continue;
        seen.add(name);
        add(name, st.label || name, hw, pr);
      }
      for (const name of Object.keys(kp)) {
        if (seen.has(name)) continue;
        const hw = (kp[name]?.homework as any[]) || [];
        const pr = (kp[name]?.practice as any[]) || [];
        if (!hw.length && !pr.length) continue;
        const label = hw[0]?.knowledge_sources?.[0]?.label || pr[0]?.knowledge_sources?.[0]?.label || name;
        add(name, label, hw, pr);
      }
      return { chapters, course: d?.course?.course_name || '' };
    } catch (e: any) {
      return { error: e?.message ?? String(e), chapters: [] };
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<style>
 html,body{height:100%;}
 body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-sideBar-background,var(--vscode-editor-background));margin:0;padding:0;font-size:13px;display:flex;flex-direction:column;height:100vh;}
 .tabs{display:flex;flex-wrap:wrap;gap:2px;padding:6px 6px 0;border-bottom:1px solid var(--vscode-panel-border);position:sticky;top:0;background:inherit;z-index:2;}
 .tab{flex:1;min-width:60px;text-align:center;font-family:inherit;font-size:12.5px;padding:7px 4px;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--vscode-descriptionForeground);cursor:pointer;}
 .tab.active{color:var(--vscode-foreground);border-bottom-color:var(--vscode-focusBorder);font-weight:600;}
 .body{flex:1;overflow:auto;padding:8px 8px 30px;}
 input.search{width:100%;box-sizing:border-box;padding:6px 8px;margin:2px 0 8px;border-radius:4px;border:1px solid var(--vscode-input-border,var(--vscode-panel-border));background:var(--vscode-input-background);color:var(--vscode-input-foreground);}
 .item{padding:5px 6px;border-radius:4px;cursor:pointer;display:flex;gap:6px;align-items:center;white-space:nowrap;overflow:hidden;}
 .item:hover{background:rgba(127,127,127,.14);}
 .item .t{overflow:hidden;text-overflow:ellipsis;flex:1;}
 .id{color:var(--vscode-descriptionForeground);font-size:11.5px;}
 .ok{color:#67c23a;font-weight:700;}
 .diff{font-size:10px;padding:0 5px;border-radius:8px;color:#fff;flex:none;}
 .diff.d1{background:#67c23a;} .diff.d2{background:#e6a23c;} .diff.d3{background:#f56c6c;} .diff.d0{background:#909399;}
 .muted{color:var(--vscode-descriptionForeground);}
 .folder{padding:6px;font-weight:600;cursor:pointer;display:flex;gap:6px;align-items:center;}
 .folder:hover{background:rgba(127,127,127,.1);}
 .children{padding-left:12px;}
 .badge{margin-left:auto;font-size:11px;color:var(--vscode-descriptionForeground);}
 .loginbox{padding:24px 16px;text-align:center;}
 .loginbtn{display:inline-block;width:100%;box-sizing:border-box;padding:12px;font-size:15px;font-weight:700;color:#fff;background:#0a84ff;border:none;border-radius:8px;cursor:pointer;box-shadow:0 2px 8px rgba(10,132,255,.4);}
 .loginbtn:hover{background:#0a74e0;}
 .card{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:14px;margin-bottom:12px;}
 .card .name{font-size:16px;font-weight:700;}
 .card .row{margin-top:6px;color:var(--vscode-descriptionForeground);}
 .btn{font-family:inherit;font-size:12.5px;padding:5px 12px;border-radius:4px;border:1px solid var(--vscode-panel-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer;margin-top:10px;}
 .err{color:#f56c6c;padding:8px;}
 .empty{padding:14px;color:var(--vscode-descriptionForeground);}
</style></head><body>
<div class="tabs">
 <button class="tab active" data-tab="problems">自由练习</button>
 <button class="tab" data-tab="trainings">课内实验</button>
 <button class="tab" data-tab="homework">作业</button>
 <button class="tab" data-tab="my">我的</button>
</div>
<div class="body" id="content"><div class="empty">加载中…</div></div>
<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 let activeTab = 'problems';
 let state = { loggedIn:false, user:null };
 const content = document.getElementById('content');
 const el = (tag, cls, txt) => { const e=document.createElement(tag); if(cls) e.className=cls; if(txt!==undefined) e.textContent=txt; return e; };

 document.querySelectorAll('.tab').forEach((b)=>b.addEventListener('click',()=>{ activeTab=b.getAttribute('data-tab'); setActive(); vscode.postMessage({type:'tab', tab:activeTab}); }));
 function setActive(){ document.querySelectorAll('.tab').forEach((b)=>b.classList.toggle('active', b.getAttribute('data-tab')===activeTab)); }

 function needLogin(){ const d=el('div','loginbox'); const b=el('button','loginbtn','登录 NUAA OJ'); b.addEventListener('click',()=>vscode.postMessage({type:'login'})); d.appendChild(el('div','muted','登录后可浏览题目、作业与提交记录')); d.appendChild(b); content.innerHTML=''; content.appendChild(d); }
 function error(t){ content.innerHTML=''; content.appendChild(el('div','err', t)); }

 // 自由练习
 function renderProblems(data, keyword){
   content.innerHTML='';
   const inp=el('input','search'); inp.placeholder='搜索题号 / 标题（回车）'; inp.value=keyword||'';
   inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ vscode.postMessage({type:'search', keyword:inp.value}); } });
   content.appendChild(inp);
   if(data.needLogin){ needLogin(); return; }
   if(data.error){ error(data.error); return; }
   const list=el('div');
   (data.items||[]).forEach((p)=>{ const it=el('div','item'); it.appendChild(el('span','id',p.id)); it.appendChild(el('span','diff d'+(p.difficulty||0), p.dlabel||'')); it.appendChild(el('span','t',p.title)); if(p.ac) it.appendChild(el('span','ok','✓')); it.title=p.tip||p.title; it.addEventListener('click',()=>vscode.postMessage({type:'openProblem', value:p.id})); list.appendChild(it); });
   content.appendChild(list);
   if(!(data.items||[]).length) content.appendChild(el('div','empty','没有找到题目。'));
 }
 // 课内实验
 window.__trainingBoxes = {};
 function fillTraining(tid, items, err){
   const box = window.__trainingBoxes && window.__trainingBoxes[tid];
   if(!box) return;
   box.innerHTML='';
   if(err){ box.appendChild(el('div','err',err)); return; }
   (items||[]).forEach((p)=>{ const it=el('div','item'); it.appendChild(el('span','id',p.id)); it.appendChild(el('span','diff d'+(p.difficulty||0), p.dlabel||'')); it.appendChild(el('span','t',p.title)); if(p.ac) it.appendChild(el('span','ok','✓')); it.title=p.tip||p.title; it.addEventListener('click',()=>vscode.postMessage({type:'openProblem', value:p.value})); box.appendChild(it); });
   if(!(items||[]).length) box.appendChild(el('div','empty','该题单暂无题目。'));
 }
 function renderTrainings(data){
   content.innerHTML='';
   if(data.needLogin){ needLogin(); return; }
   if(data.error){ error(data.error); return; }
   const all = data.items||[];
   const inp=el('input','search'); inp.placeholder='搜索课内实验（题单名）'; content.appendChild(inp);
   const box=el('div'); content.appendChild(box);
   function paint(kw){
     box.innerHTML=''; window.__trainingBoxes={};
     const list = all.filter((t)=> !kw || String(t.title||'').indexOf(kw)>=0 || String(t.category||'').indexOf(kw)>=0);
     list.forEach((t)=>{ const wrap=el('div'); const head=el('div','folder'); head.appendChild(el('span',null,'📁')); head.appendChild(el('span',null,t.title)); head.appendChild(el('span','badge',(t.count!=null? t.count+' 题':'')+(t.category?' · '+t.category:'')));
       const kids=el('div','children'); kids.style.display='none'; window.__trainingBoxes[t.tid]=kids;
       head.addEventListener('click',()=>{ if(kids.style.display==='none'){ kids.style.display='block'; if(!kids.dataset.loaded){ kids.dataset.loaded='1'; kids.appendChild(el('div','muted','加载中…')); vscode.postMessage({type:'expandTraining', tid:t.tid}); } } else kids.style.display='none'; });
       wrap.appendChild(head); wrap.appendChild(kids); box.appendChild(wrap); });
     if(!list.length) box.appendChild(el('div','empty','没有匹配的课内实验。'));
   }
   inp.addEventListener('input',()=>paint(inp.value.trim()));
   paint('');
 }
 // 作业
 function renderHomework(data){
   content.innerHTML='';
   if(data.needLogin){ needLogin(); return; }
   if(data.error){ error(data.error); return; }
   if(data.course) content.appendChild(el('div','muted','课程：'+data.course));
   (data.chapters||[]).forEach((c)=>{
     const det=el('details'); const sum=el('summary','folder'); sum.appendChild(el('span',null,c.label+(c.current?'（当前）':''))); sum.appendChild(el('span','badge','作业 '+c.pass+'/'+c.total)); det.appendChild(sum);
     const box=el('div','children');
     (c.homework||[]).forEach((p)=>box.appendChild(probItem(p,'作业')));
     if((c.practice||[]).length){ box.appendChild(el('div','muted','练习')); (c.practice||[]).forEach((p)=>box.appendChild(probItem(p,'练'))); }
     det.appendChild(box); content.appendChild(det);
   });
   if(!(data.chapters||[]).length) content.appendChild(el('div','empty','当前课程暂无作业。'));
 }
 function probItem(p){ const it=el('div','item'); it.appendChild(el('span','id',p.id)); it.appendChild(el('span','t',p.title)); if(p.ac) it.appendChild(el('span','ok','✓')); else if(p.attempted) it.appendChild(el('span','muted','未通过')); it.addEventListener('click',()=>vscode.postMessage({type:'openProblem', value:p.id})); return it; }
 // 我的
 function renderMy(user){
   content.innerHTML='';
   if(!state.loggedIn || !user){ needLogin(); return; }
   const card=el('div','card'); card.appendChild(el('div','name', user.nickname||user.username)); card.appendChild(el('div','row','账号：'+user.username)); if(user.school) card.appendChild(el('div','row','学校：'+user.school)); if(user.signature) card.appendChild(el('div','row',user.signature)); if(user.roles&&user.roles.length) card.appendChild(el('div','row','角色：'+user.roles.join(', ')));
   const lo=el('button','btn','退出登录'); lo.addEventListener('click',()=>vscode.postMessage({type:'logout'})); card.appendChild(lo);
   content.appendChild(card);
 }

 window.addEventListener('message',(e)=>{ const m=e.data;
   if(m.type==='state'){ state.loggedIn=m.loggedIn; state.user=m.user; if(activeTab==='my'){ vscode.postMessage({type:'tab',tab:'my'}); } }
   else if(m.type==='data'){ const tab=m.tab; if(tab==='problems') renderProblems(m.payload,m.keyword); else if(tab==='trainings') renderTrainings(m.payload); else if(tab==='homework') renderHomework(m.payload); else if(tab==='my') renderMy(m.payload); }
   else if(m.type==='trainingProblems'){ fillTraining(m.tid, m.items, m.error); }
   else if(m.type==='reload'){ vscode.postMessage({type:'tab',tab:activeTab}); }
   else if(m.type==='focusSearch'){ const i=document.querySelector('input.search'); if(i) i.focus(); }
   else if(m.type==='error'){ error(m.text); }
 });
 vscode.postMessage({type:'ready'});
 vscode.postMessage({type:'tab',tab:'problems'});
</script></body></html>`;
  }
}
