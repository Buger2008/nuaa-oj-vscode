import * as vscode from 'vscode';
import { AuthManager } from './auth';
import { UserInfo } from './types';
import { statusMeta } from './status';

export interface HomeCallbacks {
  openProblem: (value: string) => Promise<void>;
  openLogin: () => void;
  logout: () => Promise<void>;
  openUrl: (url: string) => void;
  openProfile: () => void;
  openSettings: () => void;
  openMessages: () => void;
  openMyHome: () => void;
  openUser: (uid: string, username: string) => void;
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
    const sub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('nuaaOj.enabledTabs')) this.postTabs();
    });
    view.onDidDispose(() => sub.dispose());
  }

  refresh(): void {
    this.problemsCache = undefined;
    this.trainingsCache = undefined;
    this.postState();
    this.postTabs();
    this.view?.webview.postMessage({ type: 'reload' });
  }

  postState(): void {
    if (!this.view) return;
    const u = this.auth.currentUser;
    this.view.webview.postMessage({ type: 'state', loggedIn: !!u, user: this.userBrief(u) });
  }

  private enabledTabs(): string[] {
    const all = ['home', 'problems', 'trainings', 'homework', 'status', 'rank', 'my'];
    const cfg = vscode.workspace.getConfiguration('nuaaOj').get<string[]>('enabledTabs', all) || all;
    const filtered = all.filter((t) => cfg.includes(t));
    return filtered.length ? filtered : all;
  }

  postTabs(): void {
    if (!this.view) return;
    this.view.webview.postMessage({ type: 'tabs', tabs: this.enabledTabs() });
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
        this.postTabs();
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
      case 'status':
        await this.sendStatus(m);
        break;
      case 'rank':
        await this.sendRank(m);
        break;
      case 'selfTests':
        await this.sendSelfTests(m);
        break;
      case 'home':
        await this.sendHome();
        break;
      case 'openUrl':
        this.cb.openUrl(String(m.url));
        break;
      case 'openProfile':
        this.cb.openProfile();
        break;
      case 'openSettings':
        this.cb.openSettings();
        break;
      case 'openMessages':
        this.cb.openMessages();
        break;
      case 'openMyHome':
        this.cb.openMyHome();
        break;
      case 'openUser':
        this.cb.openUser(String(m.uid || ''), String(m.username || ''));
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
    } else if (tab === 'status') {
      await this.sendStatus({ onlyMine: false, status: '' });
    } else if (tab === 'rank') {
      await this.sendRank({ kind: 'acm', page: 1, size: 30, search: '' });
    } else if (tab === 'home') {
      await this.sendHome();
    }
  }

  private async sendHome(): Promise<void> {
    if (!this.view) return;
    if (!(await this.auth.ensureLoggedIn(false))) {
      this.view.webview.postMessage({ type: 'home', payload: { needLogin: true } });
      return;
    }
    const payload: any = {};
    try {
      payload.rank = await this.auth.api.getRecent7ACRank();
    } catch (e: any) {
      payload.rankError = e?.message ?? String(e);
    }
    try {
      payload.stats = await this.auth.api.getLastWeekSubmissionStatistics(false);
    } catch (e: any) {
      payload.statsError = e?.message ?? String(e);
    }
    try {
      payload.recent = await this.auth.api.getRecentUpdatedProblemList();
    } catch (e: any) {
      payload.recentError = e?.message ?? String(e);
    }
    this.view.webview.postMessage({ type: 'home', payload });
  }

  private async sendRank(f: any): Promise<void> {
    if (!this.view) return;
    const kind = f?.kind === 'oi' ? 'oi' : 'acm';
    const page = Math.max(1, Number(f?.page) || 1);
    const size = [15, 30, 50, 100].includes(Number(f?.size)) ? Number(f?.size) : 30;
    const search = String(f?.search ?? '').trim();
    const filters = { kind, page, size, search };
    if (!(await this.auth.ensureLoggedIn(false))) {
      this.view.webview.postMessage({ type: 'rank', payload: { needLogin: true, items: [], total: 0, page, size, pages: 0 }, filters });
      return;
    }
    try {
      const res = await this.auth.api.getUserRank({ limit: size, currentPage: page, type: kind === 'oi' ? 1 : 0, searchUser: search || undefined });
      const offset = size * (page - 1);
      const items = (res.records || []).map((r: any, i: number) => ({
        rank: offset + i + 1,
        uid: r.uid,
        username: r.username,
        nickname: r.nickname,
        signature: r.signature,
        titleName: r.titleName,
        titleColor: r.titleColor,
        ac: r.ac,
        total: r.total,
        score: r.score,
      }));
      const total = res.total || 0;
      const pages = (res as any).pages || Math.max(1, Math.ceil(total / size));
      this.view.webview.postMessage({ type: 'rank', payload: { items, total, page, size, pages }, filters });
    } catch (e: any) {
      this.view.webview.postMessage({ type: 'rank', payload: { error: e?.message ?? String(e), items: [], total: 0, page, size, pages: 0 }, filters });
    }
  }

  private baseUrl(): string {
    return vscode.workspace.getConfiguration('nuaaOj').get<string>('baseUrl', 'https://oj.nuaa.edu.cn').replace(/\/+$/, '');
  }

  private async sendSelfTests(f: any): Promise<void> {
    if (!this.view) return;
    const onlyMine = !!f?.onlyMine;
    const status = f?.status ?? '';
    const page = Math.max(1, Number(f?.page) || 1);
    const size = [15, 30, 50, 100].includes(Number(f?.size)) ? Number(f?.size) : 20;
    const filters = { onlyMine, status, page, size };
    if (!(await this.auth.ensureLoggedIn(false))) {
      this.view.webview.postMessage({ type: 'selfTests', payload: { needLogin: true, items: [], total: 0, page, size, pages: 0 }, filters });
      return;
    }
    try {
      const res = await this.auth.api.getSelfTests({
        page,
        limit: size,
        scope: onlyMine ? 'mine' : 'all',
        status: status === '' || status == null ? undefined : Number(status),
      });
      const items = (res.records || []).map((r: any) => ({
        submitId: r.submit_id,
        displayPid: r.display_pid,
        title: r.title,
        status: r.status,
        statusLabel: r.status_label,
        time: r.time,
        memory: r.memory,
        language: r.language,
        submitTime: r.submit_time || r.completed_at,
        username: r.username,
      }));
      const total = res.total || 0;
      const pages = (res as any).pages || Math.max(1, Math.ceil(total / size));
      this.view.webview.postMessage({ type: 'selfTests', payload: { items, total, page, size, pages }, filters });
    } catch (e: any) {
      this.view.webview.postMessage({ type: 'selfTests', payload: { error: e?.message ?? String(e), items: [], total: 0, page, size, pages: 0 }, filters });
    }
  }

  private async sendStatus(f: any): Promise<void> {
    if (!this.view) return;
    const onlyMine = !!f?.onlyMine;
    const status = f?.status ?? '';
    const page = Math.max(1, Number(f?.page) || 1);
    const size = [15, 30, 50, 100].includes(Number(f?.size)) ? Number(f?.size) : 15;
    const filters = { onlyMine, status, page, size };
    if (!(await this.auth.ensureLoggedIn(false))) {
      this.view.webview.postMessage({ type: 'status', payload: { needLogin: true, items: [], total: 0, page, size, pages: 0 }, filters });
      return;
    }
    try {
      const res = await this.auth.api.getSubmissionList({
        limit: size,
        currentPage: page,
        onlyMine,
        status: status === '' || status == null ? undefined : Number(status),
      });
      const items = (res.records || []).map((r: any) => {
        const st = statusMeta(r.status);
        return {
          submitId: r.submitId,
          username: r.username,
          displayPid: r.displayPid ?? r.pid,
          title: r.title,
          statusShort: st.short,
          statusName: st.name,
          statusColor: st.color,
          time: r.time,
          memory: r.memory,
          language: r.language,
          submitTime: r.submitTime,
          url: `${this.baseUrl()}/submission-detail/${r.submitId}`,
        };
      });
      const total = res.total || 0;
      const pages = (res as any).pages || Math.max(1, Math.ceil(total / size));
      this.view.webview.postMessage({ type: 'status', payload: { items, total, page, size, pages }, filters });
    } catch (e: any) {
      this.view.webview.postMessage({ type: 'status', payload: { error: e?.message ?? String(e), items: [], total: 0, page, size, pages: 0 }, filters });
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
 .card{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:14px;margin-bottom:12px;display:flex;gap:12px;align-items:center;}
 .avatar-mini{width:52px;height:52px;border-radius:50%;background:rgba(10,132,255,.25);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex:none;}
 .menu{border:1px solid var(--vscode-panel-border);border-radius:8px;overflow:hidden;}
 .mrow{display:flex;align-items:center;padding:12px 14px;cursor:pointer;border-bottom:1px solid var(--vscode-panel-border);}
 .mrow:last-child{border-bottom:none;}
 .mrow:hover{background:rgba(127,127,127,.12);}
 .mlabel{flex:1;font-size:13.5px;} .mchev{color:var(--vscode-descriptionForeground);font-size:16px;}
 .micon{width:24px;flex:none;display:inline-flex;justify-content:center;align-items:center;font-size:15px;line-height:1;}
 .card .name{font-size:16px;font-weight:700;}
 .card .row{margin-top:6px;color:var(--vscode-descriptionForeground);}
 .btn{font-family:inherit;font-size:12.5px;padding:5px 12px;border-radius:4px;border:1px solid var(--vscode-panel-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);cursor:pointer;margin-top:10px;}
 .err{color:#f56c6c;padding:8px;}
 .empty{padding:14px;color:var(--vscode-descriptionForeground);}
 .sech{font-weight:700;font-size:13px;margin:14px 0 6px;border-left:3px solid var(--vscode-focusBorder);padding-left:7px;}
 .hchart{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:6px 8px;margin-bottom:4px;}
 .filters{display:flex;gap:8px;align-items:center;margin:2px 0 8px;flex-wrap:wrap;}
 .filters select{font-family:inherit;font-size:12px;padding:3px 6px;border-radius:4px;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border,var(--vscode-panel-border));}
 .filters label{display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;color:var(--vscode-descriptionForeground);}
 table{border-collapse:collapse;width:100%;font-size:12px;}
 th,td{border-bottom:1px solid var(--vscode-panel-border);padding:5px 4px;text-align:left;white-space:nowrap;}
 th{font-weight:600;}
 tr:hover{background:rgba(127,127,127,.12);}
 a.runid{color:var(--vscode-textLink-foreground);cursor:pointer;text-decoration:underline;}
 .pill{display:inline-block;color:#fff;border-radius:8px;padding:0 6px;font-size:10.5px;font-weight:700;}
 .pager{display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:center;margin:10px 0 4px;}
 .pg{font-family:inherit;font-size:12px;min-width:26px;padding:2px 6px;border-radius:4px;border:1px solid var(--vscode-panel-border);background:transparent;color:var(--vscode-foreground);cursor:pointer;}
 .pg:hover{background:rgba(127,127,127,.18);}
 .pg.active{background:#0a84ff;border-color:#0a84ff;color:#fff;font-weight:700;}
 .pg:disabled{opacity:.4;cursor:default;}
 .pgdots{padding:0 2px;color:var(--vscode-descriptionForeground);}
 .rchart{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px 10px;margin-bottom:8px;}
 .rtip{position:fixed;z-index:99999;display:none;padding:4px 8px;border-radius:4px;font-size:12px;pointer-events:none;white-space:nowrap;max-width:92vw;overflow:hidden;text-overflow:ellipsis;background:var(--vscode-editorHoverWidget-background,#252526);color:var(--vscode-editorHoverWidget-foreground,#fff);border:1px solid var(--vscode-panel-border);box-shadow:0 2px 8px rgba(0,0,0,.4);}
 .rlegend{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;}
 .rrow{display:flex;gap:6px;align-items:center;margin:3px 0;font-size:11.5px;}
 .rname{width:68px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);}
 .rbars{flex:1;display:flex;gap:6px;align-items:center;}
 .rbarwrap{flex:1;display:flex;align-items:center;gap:4px;}
 .rbar{height:9px;border-radius:4px;flex:none;}
 .rbarval{font-size:10px;color:var(--vscode-descriptionForeground);}
</style></head><body>
<div class="tabs">
 <button class="tab active" data-tab="home">首页</button>
 <button class="tab" data-tab="problems">自由练习</button>
 <button class="tab" data-tab="trainings">课内实验</button>
 <button class="tab" data-tab="homework">作业</button>
 <button class="tab" data-tab="status">状态</button>
 <button class="tab" data-tab="rank">排名</button>
 <button class="tab" data-tab="my">我的</button>
</div>
<div class="body" id="content"><div class="empty">加载中…</div></div>
<script nonce="${nonce}">
 const vscode = acquireVsCodeApi();
 let activeTab = 'home';
 let state = { loggedIn:false, user:null };
 const content = document.getElementById('content');
 const el = (tag, cls, txt) => { const e=document.createElement(tag); if(cls) e.className=cls; if(txt!==undefined) e.textContent=txt; return e; };
 function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
 const rtip=document.createElement('div'); rtip.className='rtip'; document.body.appendChild(rtip);
 function attachTips(root){ if(!root||!root.querySelectorAll) return; root.querySelectorAll('[data-tip]').forEach(function(el){ el.addEventListener('mousemove',function(e){ rtip.textContent=el.getAttribute('data-tip'); rtip.style.display='block'; var w=rtip.offsetWidth||0, h=rtip.offsetHeight||0; var vw=(window&&window.innerWidth)||(document.documentElement&&document.documentElement.clientWidth)||9999; var vh=(window&&window.innerHeight)||(document.documentElement&&document.documentElement.clientHeight)||9999; var x=e.clientX+12; if(x+w>vw-6) x=e.clientX-w-12; if(x<4) x=4; var y=e.clientY+12; if(y+h>vh-6) y=e.clientY-h-12; if(y<4) y=4; rtip.style.left=x+'px'; rtip.style.top=y+'px'; }); el.addEventListener('mouseleave',function(){ rtip.style.display='none'; }); }); }

 document.querySelectorAll('.tab').forEach((b)=>b.addEventListener('click',()=>{ activeTab=b.getAttribute('data-tab'); setActive(); vscode.postMessage({type:'tab', tab:activeTab}); }));
 function setActive(){ document.querySelectorAll('.tab').forEach((b)=>b.classList.toggle('active', b.getAttribute('data-tab')===activeTab)); }
 function applyTabs(tabs){ const list=Array.isArray(tabs)&&tabs.length?tabs:['home','problems','trainings','homework','status','rank','my']; const set={}; list.forEach(function(t){set[t]=1;}); document.querySelectorAll('.tab').forEach(function(b){ const t=b.getAttribute('data-tab'); if(t) b.style.display = set[t] ? '' : 'none'; }); if(!set[activeTab]){ activeTab=list[0]; setActive(); vscode.postMessage({type:'tab', tab:activeTab}); } }

 function needLogin(){ const d=el('div','loginbox'); const b=el('button','loginbtn','登录 NUAA OJ'); b.addEventListener('click',()=>vscode.postMessage({type:'login'})); d.appendChild(el('div','muted','登录后可浏览题目、作业与提交记录')); d.appendChild(b); content.innerHTML=''; content.appendChild(d); }
 function error(t){ content.innerHTML=''; content.appendChild(el('div','err', t)); }

 // 首页
 function secTitle(t){ return el('div','sech',t); }
 function lineChart(stats){
   const dates=(stats&&stats.dateStrList)||[], ac=(stats&&stats.acCountList)||[], tot=(stats&&stats.totalCountList)||[];
   const n=dates.length; if(!n) return '<div class="muted">暂无数据</div>';
   const W=320,H=150,padL=30,padR=8,padT=10,padB=20,iw=W-padL-padR,ih=H-padT-padB;
   const max=Math.max.apply(null, tot.concat(ac).concat([1]));
   function X(i){ return padL + (n<=1? iw/2 : iw*i/(n-1)); }
   function Y(v){ return padT + ih*(1-(Number(v)||0)/max); }
   function poly(arr){ return arr.map(function(v,i){ return X(i).toFixed(1)+','+Y(v).toFixed(1); }).join(' '); }
   let s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'">';
   s+='<line x1="'+padL+'" y1="'+padT+'" x2="'+padL+'" y2="'+(padT+ih)+'" stroke="rgba(127,127,127,.35)"/>';
   s+='<line x1="'+padL+'" y1="'+(padT+ih)+'" x2="'+(padL+iw)+'" y2="'+(padT+ih)+'" stroke="rgba(127,127,127,.35)"/>';
   s+='<polyline fill="none" stroke="#909399" stroke-width="1.6" points="'+poly(tot)+'"/>';
   s+='<polyline fill="none" stroke="#0a84ff" stroke-width="2" points="'+poly(ac)+'"/>';
   tot.forEach(function(v,i){ s+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="2.2" fill="#909399"><title>'+esc(dates[i])+' 总提交 '+v+'</title></circle>'; });
   ac.forEach(function(v,i){ s+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="2.4" fill="#0a84ff"><title>'+esc(dates[i])+' AC '+v+'</title></circle>'; });
   dates.forEach(function(d,i){ if(n<=7 || i%2===0){ s+='<text x="'+X(i).toFixed(1)+'" y="'+(H-4)+'" font-size="9" fill="currentColor" text-anchor="middle">'+esc(d)+'</text>'; } });
   s+='</svg>';
   return s + '<div class="muted">■ AC <span style="color:#909399">■ 总提交</span> · 近7天（最大值 '+max+'）</div>';
 }
 function renderHome(data){
   content.innerHTML='';
   if(data.needLogin){ needLogin(); return; }
   // 过题榜单
   content.appendChild(secTitle('近 7 天过题榜单'));
   if(data.rankError){ content.appendChild(el('div','err','榜单加载失败：'+data.rankError)); }
   else if(data.rank && data.rank.length){
     const tbl=document.createElement('table'); const thead=document.createElement('thead'); const hr=document.createElement('tr');
     ['#','用户','昵称','AC'].forEach(function(h){ hr.appendChild(el('th','',h)); }); thead.appendChild(hr); tbl.appendChild(thead);
     const tb=document.createElement('tbody');
     data.rank.forEach(function(r,i){ const tr=document.createElement('tr');
       tr.appendChild(el('td','',String(i+1)));
       const tdu=el('td'); const a=el('a','runid',r.username||''); a.href='#'; a.title='打开个人主页'; a.addEventListener('click',function(e){ e.preventDefault(); vscode.postMessage({type:'openUser', uid:r.uid, username:r.username}); }); tdu.appendChild(a); if(r.titleName){ const tg=el('span','pill',r.titleName); tg.style.background=r.titleColor||'#409eff'; tg.style.marginLeft='4px'; tdu.appendChild(tg);} tr.appendChild(tdu);
       tr.appendChild(el('td','',r.nickname||''));
       tr.appendChild(el('td','',String(r.ac!=null?r.ac:'-')));
       tb.appendChild(tr);
     });
     tbl.appendChild(tb); content.appendChild(tbl);
   } else { content.appendChild(el('div','empty','暂无数据')); }
   // 提交统计
   content.appendChild(secTitle('近 7 天提交统计'));
   if(data.statsError){ content.appendChild(el('div','err','统计加载失败：'+data.statsError)); }
   else if(data.stats){ const d=el('div','hchart'); try{ d.innerHTML=lineChart(data.stats); }catch(e){ d.textContent='图表渲染失败：'+(e&&e.message); } content.appendChild(d);
     const st=data.stats, dates=st.dateStrList||[], acs=st.acCountList||[], tots=st.totalCountList||[];
     if(dates.length){
       const t=document.createElement('table'); const th=document.createElement('thead'); const hr=document.createElement('tr');
       ['日期','AC','总提交'].forEach(function(h){ hr.appendChild(el('th','',h)); }); th.appendChild(hr); t.appendChild(th);
       const tb=document.createElement('tbody'); let sumA=0,sumT=0;
       dates.forEach(function(dt,i){ const a=Number(acs[i])||0, tt=Number(tots[i])||0; sumA+=a; sumT+=tt; const tr=document.createElement('tr'); tr.appendChild(el('td','',dt)); tr.appendChild(el('td','',String(a))); tr.appendChild(el('td','',String(tt))); tb.appendChild(tr); });
       const tr=document.createElement('tr'); const tda=el('td','','合计'); tda.style.fontWeight='700'; tr.appendChild(tda); const a2=el('td','',String(sumA)); a2.style.fontWeight='700'; tr.appendChild(a2); const t2=el('td','',String(sumT)); t2.style.fontWeight='700'; tr.appendChild(t2); tb.appendChild(tr);
       t.appendChild(tb); content.appendChild(t);
     }
   }
   else content.appendChild(el('div','empty','暂无数据'));
   // 最近更新题目
   content.appendChild(secTitle('最近更新题目'));
   if(data.recentError){ content.appendChild(el('div','err','加载失败：'+data.recentError)); }
   else if(data.recent && data.recent.length){
     const list=el('div');
     data.recent.forEach(function(p){ const it=el('div','item'); it.appendChild(el('span','id',p.problemId)); it.appendChild(el('span','t',p.title||'')); it.title=p.title||''; it.addEventListener('click',function(){ vscode.postMessage({type:'openProblem', value:p.problemId}); }); list.appendChild(it); });
     content.appendChild(list);
   } else content.appendChild(el('div','empty','暂无数据'));
 }
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
   const card=el('div','card');
   const initial=(user.nickname||user.username||'?').slice(0,1).toUpperCase();
   card.appendChild(el('div','avatar-mini',initial));
   const info=el('div');
   info.appendChild(el('div','name', user.nickname||user.username));
   info.appendChild(el('div','row','账号：'+user.username));
   if(user.school) info.appendChild(el('div','row','学校：'+user.school));
   if(user.signature) info.appendChild(el('div','row',user.signature));
   if(user.roles&&user.roles.length) info.appendChild(el('div','row','角色：'+user.roles.join(', ')));
   card.appendChild(info); content.appendChild(card);
   const menu=el('div','menu');
   function row(icon, label, fn){ const r=el('div','mrow'); r.appendChild(el('span','micon',icon)); r.appendChild(el('span','mlabel',label)); r.appendChild(el('span','mchev','›')); r.addEventListener('click',fn); menu.appendChild(r); }
   row('👤', '我的主页', function(){ vscode.postMessage({type:'openMyHome'}); });
   row('📥', '我的提交', function(){ openMySubs(); });
   row('📊', '能力画像', function(){ vscode.postMessage({type:'openProfile'}); });
   row('🔔', '系统通知', function(){ vscode.postMessage({type:'openMessages'}); });
   row('⚙️', '设置', function(){ vscode.postMessage({type:'openSettings'}); });
   row('🚪', '退出登录', function(){ vscode.postMessage({type:'logout'}); });
   content.appendChild(menu);
 }
 function openMySubs(){ activeTab='status'; if(typeof setActive==='function') setActive(); vscode.postMessage({type:'status', onlyMine:true, status:'', page:1, size:30}); }

 // 我的
 let rankChartType = 'bar';
 let statusMode = 'formal';
 let lastRankData = null, lastRankFilters = null;
 function rankLegend(kind){ return kind==='acm' ? '<div class="rlegend"><span style="color:#0a84ff">■ AC</span> <span style="color:#909399">■ Total</span></div>' : '<div class="rlegend"><span style="color:#8b5cf6">■ Score</span></div>'; }
 function barSpan(v,max,color){ const w=Math.max(2,Math.round(v/max*100)); return '<div class="rbarwrap"><div class="rbar" style="width:'+w+'%;background:'+color+'"></div><span class="rbarval">'+v+'</span></div>'; }
 function rankBarInner(top,kind){ const max=Math.max.apply(null, top.map(function(r){ return Math.max(r.ac||0,r.total||0,r.score||0); }).concat([1])); let h=''; top.forEach(function(r){ h+='<div class="rrow"><span class="rname">'+esc(r.username||r.nickname||'')+'</span><div class="rbars">'; if(kind==='acm'){ h+=barSpan(r.ac||0,max,'#0a84ff'); h+=barSpan(r.total||0,max,'#909399'); } else h+=barSpan(r.score||0,max,'#8b5cf6'); h+='</div></div>'; }); return h; }
 function rankLineSvg(top,kind){
   const n=top.length; if(!n) return '<div class="muted">暂无数据</div>';
   const W=320,H=140,padL=26,padR=8,padT=10,padB=14,iw=W-padL-padR,ih=H-padT-padB;
   const series = kind==='acm' ? [['AC',top.map(function(r){return r.ac||0;}),'#0a84ff'],['Total',top.map(function(r){return r.total||0;}),'#909399']] : [['Score',top.map(function(r){return r.score||0;}),'#8b5cf6']];
   let allv=[]; series.forEach(function(se){ allv=allv.concat(se[1]); });
   const max=Math.max.apply(null, allv.concat([1]));
   function X(i){ return padL+(n<=1?iw/2:iw*i/(n-1)); } function Y(v){ return padT+ih*(1-v/max); }
   let s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'">';
   s+='<line x1="'+padL+'" y1="'+padT+'" x2="'+padL+'" y2="'+(padT+ih)+'" stroke="rgba(127,127,127,.35)"/><line x1="'+padL+'" y1="'+(padT+ih)+'" x2="'+(padL+iw)+'" y2="'+(padT+ih)+'" stroke="rgba(127,127,127,.35)"/>';
   series.forEach(function(se){ const pts=se[1].map(function(v,i){return X(i).toFixed(1)+','+Y(v).toFixed(1);}).join(' '); s+='<polyline fill="none" stroke="'+se[2]+'" stroke-width="2" points="'+pts+'"/>'; se[1].forEach(function(v,i){ s+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="2" fill="'+se[2]+'"/>'; }); });
   const slot=n<=1?iw:iw/(n-1);
   top.forEach(function(r,i){ const tip = kind==='acm' ? ('#'+(i+1)+' '+esc(r.username||'')+'  ·  AC '+(r.ac||0)+'  ·  Total '+(r.total||0)) : ('#'+(i+1)+' '+esc(r.username||'')+'  ·  Score '+(r.score||0)); const x=X(i); s+='<rect x="'+(x-slot/2).toFixed(1)+'" y="'+padT+'" width="'+slot.toFixed(1)+'" height="'+ih+'" fill="transparent" data-tip="'+tip+'"/>'; });
   top.forEach(function(r,i){ s+='<text x="'+X(i).toFixed(1)+'" y="'+(H-3)+'" font-size="8" fill="currentColor" text-anchor="middle">'+(i+1)+'</text>'; });
   s+='</svg>'; return s;
 }
 function rankStackSvg(top,kind){
   const n=top.length; if(!n) return '<div class="muted">暂无数据</div>';
   const W=320,H=140,padL=8,padR=8,padT=10,padB=14,iw=W-padL-padR,ih=H-padT-padB;
   const max=Math.max.apply(null, top.map(function(r){ return kind==='acm' ? (r.total||0) : (r.score||0); }).concat([1]));
   const slot=iw/n; const bw=Math.max(4,slot*0.6);
   let s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'">';
   s+='<line x1="'+padL+'" y1="'+(padT+ih)+'" x2="'+(padL+iw)+'" y2="'+(padT+ih)+'" stroke="rgba(127,127,127,.35)"/>';
   top.forEach(function(r,i){ const cx=padL+slot*(i+0.5); const x=(cx-bw/2).toFixed(1); const base=padT+ih;
     if(kind==='acm'){ const ac=r.ac||0, tot=r.total||0; const hAc=ih*ac/max, hRest=ih*Math.max(0,tot-ac)/max; const yRest=base-hAc-hRest;
       if(hRest>0) s+='<rect x="'+x+'" y="'+yRest.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+hRest.toFixed(1)+'" fill="#909399"/>';
       s+='<rect x="'+x+'" y="'+(base-hAc).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+hAc.toFixed(1)+'" fill="#0a84ff"/>';
     } else { const h=ih*(r.score||0)/max; s+='<rect x="'+x+'" y="'+(base-h).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" fill="#8b5cf6"/>'; }
     s+='<text x="'+cx.toFixed(1)+'" y="'+(H-3)+'" font-size="8" fill="currentColor" text-anchor="middle">'+(i+1)+'</text>';
   });
   top.forEach(function(r,i){ const cx=padL+slot*(i+0.5); const tip = kind==='acm' ? ('#'+(i+1)+' '+esc(r.username||'')+'  ·  AC '+(r.ac||0)+'  ·  Total '+(r.total||0)) : ('#'+(i+1)+' '+esc(r.username||'')+'  ·  Score '+(r.score||0)); s+='<rect x="'+(padL+slot*i).toFixed(1)+'" y="'+padT+'" width="'+slot.toFixed(1)+'" height="'+ih+'" fill="transparent" data-tip="'+tip+'"/>'; });
   s+='</svg>'; return s;
 }
 function renderRank(data, filters){
   content.innerHTML='';
   if(data.needLogin){ needLogin(); return; }
   const f={ kind:(filters&&filters.kind)==='oi'?'oi':'acm', page:(data&&data.page)||1, size:(data&&data.size)||30, search:(filters&&filters.search)||'' };
   function fire(){ vscode.postMessage({type:'rank', kind:f.kind, page:f.page, size:f.size, search:f.search}); }
   const bar=el('div','filters');
   const bA=el('button','tab'+(f.kind==='acm'?' active':''),'ACM'); const bO=el('button','tab'+(f.kind==='oi'?' active':''),'OI');
   bA.addEventListener('click',function(){ f.kind='acm'; f.page=1; fire(); });
   bO.addEventListener('click',function(){ f.kind='oi'; f.page=1; fire(); });
   const inp=el('input','search'); inp.placeholder='搜索用户名/昵称/真名'; inp.value=f.search; inp.style.marginBottom='0'; inp.style.flex='1'; inp.style.width='auto';
   inp.addEventListener('keydown',function(e){ if(e.key==='Enter'){ f.search=inp.value.trim(); f.page=1; fire(); } });
   const sizeSel=document.createElement('select'); [15,30,50,100].forEach(function(n){ var o=document.createElement('option'); o.value=String(n); o.textContent=n+'条/页'; sizeSel.appendChild(o); }); sizeSel.value=String(f.size);
   sizeSel.addEventListener('change',function(){ f.size=Number(sizeSel.value); f.page=1; fire(); });
   bar.appendChild(bA); bar.appendChild(bO); bar.appendChild(inp); bar.appendChild(sizeSel); content.appendChild(bar);
   if(data.error){ error(data.error); return; }
   const items=data.items||[];
   if(!items.length){ content.appendChild(el('div','empty','没有匹配的排名。')); return; }
   const top=items.slice(0,10);
   lastRankData=data; lastRankFilters={kind:f.kind,page:f.page,size:f.size,search:f.search};
   const cbar=el('div','filters');
   const types = f.kind==='acm' ? [['bar','柱状'],['line','折线'],['stack','堆叠']] : [['bar','柱状'],['line','折线']];
   types.forEach(function(pair){ const b=el('button','tab'+(rankChartType===pair[0]?' active':''),pair[1]); b.addEventListener('click',function(){ rankChartType=pair[0]; renderRank(lastRankData,lastRankFilters); }); cbar.appendChild(b); });
   content.appendChild(cbar);
   const chart=el('div','rchart');
   try{
     chart.innerHTML = (rankChartType==='line') ? (rankLineSvg(top,f.kind)+rankLegend(f.kind))
       : (rankChartType==='stack') ? (rankStackSvg(top,f.kind)+rankLegend(f.kind))
       : (rankBarInner(top,f.kind)+rankLegend(f.kind));
   }catch(e){ chart.textContent='图表渲染失败：'+(e&&e.message); }
   content.appendChild(chart);
   attachTips(chart);
   const tbl=document.createElement('table');
   const thead=document.createElement('thead'); const hr=document.createElement('tr');
   const cols = f.kind==='acm' ? ['#','用户','昵称','AC/Total','AC率','签名'] : ['#','用户','昵称','得分','AC/Total','AC率','签名'];
   cols.forEach(function(h){ hr.appendChild(el('th','',h)); }); thead.appendChild(hr); tbl.appendChild(thead);
   const tb=document.createElement('tbody');
   items.forEach(function(r){
     const tr=document.createElement('tr');
     tr.appendChild(el('td','',String(r.rank)));
     const tdu=el('td'); const ua=el('a','runid', r.username||''); ua.href='#'; ua.title='打开个人主页'; ua.addEventListener('click',function(e){ e.preventDefault(); vscode.postMessage({type:'openUser', uid:r.uid, username:r.username}); }); tdu.appendChild(ua); if(r.titleName){ const tg=el('span','pill',r.titleName); tg.style.background=r.titleColor||'#409eff'; tg.style.marginLeft='4px'; tdu.appendChild(tg); } tr.appendChild(tdu);
     tr.appendChild(el('td','',r.nickname||''));
     if(f.kind!=='acm') tr.appendChild(el('td','',String(r.score!=null?r.score:'-')));
     tr.appendChild(el('td','',(r.ac||0)+'/'+(r.total||0)));
     tr.appendChild(el('td','', r.total? ((r.ac||0)/r.total*100).toFixed(1)+'%':'0%'));
     tr.appendChild(el('td','',r.signature||''));
     tb.appendChild(tr);
   });
   tbl.appendChild(tb); content.appendChild(tbl);
   const total=Number(data.total)||0; const size=Number(data.size)||f.size; const pages=Math.max(1,Number(data.pages)||Math.ceil(total/size)||1); const cur=Math.min(Math.max(1,Number(data.page)||1),pages);
   function go(p){ f.page=p; fire(); }
   function mk(label,page,dis,act){ const b=el('button','pg'+(act?' active':''),label); if(dis)b.disabled=true; else b.addEventListener('click',function(){ go(page); }); return b; }
   function pageList(c,t){ const a=[]; if(t<=7){ for(var i=1;i<=t;i++)a.push(i); return a; } a.push(1); var s=Math.max(2,c-1),e=Math.min(t-1,c+1); if(s>2)a.push('...'); for(var j=s;j<=e;j++)a.push(j); if(e<t-1)a.push('...'); if(t>1)a.push(t); return a; }
   const pager=el('div','pager');
   pager.appendChild(mk('‹',Math.max(1,cur-1),cur<=1,false));
   pageList(cur,pages).forEach(function(pg){ if(pg==='...')pager.appendChild(el('span','pgdots','…')); else pager.appendChild(mk(String(pg),Number(pg),false,Number(pg)===cur)); });
   pager.appendChild(mk('›',Math.min(pages,cur+1),cur>=pages,false));
   content.appendChild(pager);
   content.appendChild(el('div','muted','共 '+total+' 人 · 第 '+cur+' / '+pages+' 页'));
 }
 function statusSubTabs(){
   const bar=el('div','filters');
   const bf=el('button','tab'+(statusMode==='formal'?' active':''),'正式提交');
   const bs=el('button','tab'+(statusMode==='self'?' active':''),'在线自测');
   bf.addEventListener('click',function(){ if(statusMode==='formal') return; statusMode='formal'; vscode.postMessage({type:'status',onlyMine:false,status:'',page:1,size:30}); });
   bs.addEventListener('click',function(){ if(statusMode==='self') return; statusMode='self'; vscode.postMessage({type:'selfTests',onlyMine:false,status:'',page:1,size:20}); });
   bar.appendChild(bf); bar.appendChild(bs); return bar;
 }
 function stColor(s){ if(Number(s)===0) return '#67c23a'; if(Number(s)===-1) return '#f56c6c'; if(Number(s)===-2) return '#e6a23c'; if(Number(s)===1) return '#409eff'; if(Number(s)===3) return '#f56c6c'; return '#909399'; }
 function renderSelfTests(data, filters){
   content.innerHTML=''; content.appendChild(statusSubTabs());
   if(statusMode!=='self') return;
   if(data.needLogin){ needLogin(); return; }
   const f={ onlyMine:!!(filters&&filters.onlyMine), status:(filters&&filters.status!=null)?String(filters.status):'', page:(data&&data.page)||1, size:(data&&data.size)||20 };
   function fire(){ vscode.postMessage({type:'selfTests', onlyMine:f.onlyMine, status:f.status, page:f.page, size:f.size}); }
   const bar=el('div','filters');
   const sel=document.createElement('select');
   [['','全部状态'],['0','输出符合预期'],['-1','输出不符'],['-2','编译错误'],['1','超时'],['2','内存超限'],['3','运行错误']].forEach(function(p){ const o=document.createElement('option'); o.value=p[0]; o.textContent=p[1]; sel.appendChild(o); });
   sel.value=f.status; sel.addEventListener('change',function(){ f.status=sel.value; f.page=1; fire(); });
   const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=f.onlyMine; chk.addEventListener('change',function(){ f.onlyMine=chk.checked; f.page=1; fire(); });
   const lab=el('label',''); lab.appendChild(chk); lab.appendChild(document.createTextNode('只看我的'));
   const sizeSel=document.createElement('select'); [15,30,50,100].forEach(function(n){ const o=document.createElement('option'); o.value=String(n); o.textContent=n+'条/页'; sizeSel.appendChild(o); }); sizeSel.value=String(f.size); sizeSel.addEventListener('change',function(){ f.size=Number(sizeSel.value); f.page=1; fire(); });
   bar.appendChild(sel); bar.appendChild(lab); bar.appendChild(sizeSel); content.appendChild(bar);
   if(data.error){ error(data.error); return; }
   const items=data.items||[];
   if(!items.length){ content.appendChild(el('div','empty','没有匹配的在线自测记录。')); return; }
   const tbl=document.createElement('table'); const thead=document.createElement('thead'); const hr=document.createElement('tr');
   ['RUNID','用户','题目','状态','时间','内存','语言','提交时间'].forEach(function(h){ hr.appendChild(el('th','',h)); }); thead.appendChild(hr); tbl.appendChild(thead);
   const tb=document.createElement('tbody');
   items.forEach(function(r){ const tr=document.createElement('tr');
     tr.appendChild(el('td','','#'+r.submitId));
     tr.appendChild(el('td','',r.username||''));
     tr.appendChild(el('td','',(r.displayPid||'')+' '+(r.title||'')));
     const tds=el('td'); const pill=el('span','pill',r.statusLabel||('状态'+r.status)); pill.style.background=stColor(r.status); tds.appendChild(pill); tr.appendChild(tds);
     tr.appendChild(el('td','',(r.time==null?'-':r.time)+' ms'));
     tr.appendChild(el('td','',(r.memory==null?'-':r.memory)+' KB'));
     tr.appendChild(el('td','',r.language||''));
     tr.appendChild(el('td','',r.submitTime||''));
     tb.appendChild(tr);
   });
   tbl.appendChild(tb); content.appendChild(tbl);
   const total=Number(data.total)||0; const size=Number(data.size)||f.size; const pages=Math.max(1,Number(data.pages)||Math.ceil(total/size)||1); const cur=Math.min(Math.max(1,Number(data.page)||1),pages);
   function go(p){ f.page=p; fire(); }
   function mk(l,page,dis,act){ const b=el('button','pg'+(act?' active':''),l); if(dis)b.disabled=true; else b.addEventListener('click',function(){go(page);}); return b; }
   function pageList(c,t){ const a=[]; if(t<=7){ for(var i=1;i<=t;i++)a.push(i); return a; } a.push(1); var s=Math.max(2,c-1),e=Math.min(t-1,c+1); if(s>2)a.push('...'); for(var j=s;j<=e;j++)a.push(j); if(e<t-1)a.push('...'); if(t>1)a.push(t); return a; }
   const pager=el('div','pager');
   pager.appendChild(mk('‹',Math.max(1,cur-1),cur<=1,false));
   pageList(cur,pages).forEach(function(pg){ if(pg==='...')pager.appendChild(el('span','pgdots','…')); else pager.appendChild(mk(String(pg),Number(pg),false,Number(pg)===cur)); });
   pager.appendChild(mk('›',Math.min(pages,cur+1),cur>=pages,false));
   content.appendChild(pager);
   content.appendChild(el('div','muted','共 '+total+' 条 · 第 '+cur+' / '+pages+' 页'));
 }
 function renderStatus(data, filters){
   content.innerHTML=''; content.appendChild(statusSubTabs());
   if(statusMode!=='formal') return;
   if(data.needLogin){ needLogin(); return; }
   const f={ onlyMine:!!(filters&&filters.onlyMine), status:(filters&&filters.status!=null)?String(filters.status):'', page:(data&&data.page)||1, size:(data&&data.size)||15 };
   function fire(){ vscode.postMessage({type:'status', onlyMine:f.onlyMine, status:f.status, page:f.page, size:f.size}); }
   const bar=el('div','filters');
   const sel=document.createElement('select');
   const opts=[['','全部状态'],['0','AC'],['-1','WA'],['1','TLE'],['2','MLE'],['3','RE'],['-2','CE'],['-3','PE'],['4','SE'],['8','PA']];
   opts.forEach(function(pair){ const o=document.createElement('option'); o.value=pair[0]; o.textContent=pair[1]; sel.appendChild(o); });
   sel.value=f.status;
   const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=f.onlyMine;
   const lab=el('label',''); lab.appendChild(chk); lab.appendChild(document.createTextNode('只看我的'));
   const sizeSel=document.createElement('select');
   [15,30,50,100].forEach(function(n){ const o=document.createElement('option'); o.value=String(n); o.textContent=n+'条/页'; sizeSel.appendChild(o); });
   sizeSel.value=String(f.size);
   sel.addEventListener('change',function(){ f.status=sel.value; f.page=1; fire(); });
   chk.addEventListener('change',function(){ f.onlyMine=chk.checked; f.page=1; fire(); });
   sizeSel.addEventListener('change',function(){ f.size=Number(sizeSel.value); f.page=1; fire(); });
   bar.appendChild(sel); bar.appendChild(lab); bar.appendChild(sizeSel); content.appendChild(bar);
   if(data.error){ error(data.error); return; }
   const items=data.items||[];
   if(!items.length){ content.appendChild(el('div','empty','没有匹配的提交。')); return; }
   const tbl=document.createElement('table');
   const thead=document.createElement('thead'); const hr=document.createElement('tr');
   ['RUNID','用户','题目','状态','时间','内存','语言','提交时间'].forEach(function(h){ hr.appendChild(el('th','',h)); }); thead.appendChild(hr); tbl.appendChild(thead);
   const tb=document.createElement('tbody');
   items.forEach(function(r){
     const tr=document.createElement('tr');
     const td0=el('td'); const a=el('a','runid','#'+r.submitId); a.href='#'; a.addEventListener('click',function(e){ e.preventDefault(); vscode.postMessage({type:'openUrl',url:r.url}); }); td0.appendChild(a); tr.appendChild(td0);
     tr.appendChild(el('td','',r.username||''));
     tr.appendChild(el('td','',(r.displayPid||'')+' '+(r.title||'')));
     const tdst=el('td'); const pill=el('span','pill',r.statusShort); pill.style.background=r.statusColor; tdst.appendChild(pill); tdst.appendChild(document.createTextNode(' '+r.statusName)); tr.appendChild(tdst);
     tr.appendChild(el('td','',(r.time==null?'-':r.time)+' ms'));
     tr.appendChild(el('td','',(r.memory==null?'-':r.memory)+' KB'));
     tr.appendChild(el('td','',r.language||''));
     tr.appendChild(el('td','',r.submitTime? new Date(r.submitTime).toLocaleString():''));
     tb.appendChild(tr);
   });
   tbl.appendChild(tb); content.appendChild(tbl);

   const total=Number(data.total)||0;
   const size=Number(data.size)||f.size;
   const pages=Math.max(1, Number(data.pages)||Math.ceil(total/size)||1);
   const cur=Math.min(Math.max(1, Number(data.page)||1), pages);
   function go(p){ f.page=p; fire(); }
   function mk(label,page,disabled,active){ const b=el('button','pg'+(active?' active':''),label); if(disabled){ b.disabled=true; } else { b.addEventListener('click',function(){ go(page); }); } return b; }
   function pageList(c,t){ const arr=[]; if(t<=7){ for(var i=1;i<=t;i++) arr.push(i); return arr; } arr.push(1); const s=Math.max(2,c-1), e=Math.min(t-1,c+1); if(s>2) arr.push('...'); for(var i2=s;i2<=e;i2++) arr.push(i2); if(e<t-1) arr.push('...'); if(t>1) arr.push(t); return arr; }
   const pager=el('div','pager');
   pager.appendChild(mk('‹', Math.max(1,cur-1), cur<=1, false));
   pageList(cur,pages).forEach(function(pg){ if(pg==='...'){ pager.appendChild(el('span','pgdots','…')); } else { pager.appendChild(mk(String(pg), Number(pg), false, Number(pg)===cur)); } });
   pager.appendChild(mk('›', Math.min(pages,cur+1), cur>=pages, false));
   content.appendChild(pager);
   content.appendChild(el('div','muted','共 '+total+' 条 · 第 '+cur+' / '+pages+' 页'));
 }

 window.addEventListener('message',(e)=>{ const m=e.data;
   if(m.type==='tabs'){ applyTabs(m.tabs); return; }
   if(m.type==='status'){ renderStatus(m.payload, m.filters); return; }
   if(m.type==='selfTests'){ renderSelfTests(m.payload, m.filters); return; }
   if(m.type==='rank'){ renderRank(m.payload, m.filters); return; }
   if(m.type==='home'){ renderHome(m.payload); return; }
   if(m.type==='state'){ state.loggedIn=m.loggedIn; state.user=m.user; if(activeTab==='my'){ vscode.postMessage({type:'tab',tab:'my'}); } }
   else if(m.type==='data'){ const tab=m.tab; if(tab==='problems') renderProblems(m.payload,m.keyword); else if(tab==='trainings') renderTrainings(m.payload); else if(tab==='homework') renderHomework(m.payload); else if(tab==='my') renderMy(m.payload); }
   else if(m.type==='trainingProblems'){ fillTraining(m.tid, m.items, m.error); }
   else if(m.type==='reload'){ vscode.postMessage({type:'tab',tab:activeTab}); }
   else if(m.type==='focusSearch'){ const i=document.querySelector('input.search'); if(i) i.focus(); }
   else if(m.type==='error'){ error(m.text); }
 });
 vscode.postMessage({type:'ready'});
 vscode.postMessage({type:'tab',tab:'home'});
</script></body></html>`;
  }
}

