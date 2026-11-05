import * as vscode from 'vscode';
import * as path from 'path';
import { AuthManager } from './auth';
import { statusMeta } from './status';
import { ProblemContext, extensionToLanguage, isLanguageLocked, pickLanguage, submissionLanguage } from './context';

function difficultyLabel(d: any): string {
  switch (Number(d)) {
    case 1:
      return '简单';
    case 2:
      return '中等';
    case 3:
      return '困难';
    default:
      return '未分类';
  }
}

function pct(n: any, total: number): string {
  if (!total) return '0%';
  return ((Number(n) || 0) / total * 100).toFixed(2) + '%';
}

/** Rich hover tooltip: difficulty + verdict pass-rate distribution. */
function buildProblemTooltip(p: any): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${p.problemId ?? p.displayPid ?? ''}  ${p.title ?? ''}**\n\n`);
  md.appendMarkdown(`难度：**${difficultyLabel(p.difficulty)}**\n\n`);
  const total = Number(p.total) || 0;
  if (total > 0) {
    const rows: Array<[string, string]> = [
      ['AC', 'ac'],
      ['WA', 'wa'],
      ['TLE', 'tle'],
      ['MLE', 'mle'],
      ['RE', 're'],
      ['PE', 'pe'],
      ['CE', 'ce'],
      ['SE', 'se'],
    ];
    const lines = rows.map(([label, key]) => `${label}  ${pct(p[key], total)}`);
    if (Number(p.pa) > 0) lines.push(`PA  ${pct(p.pa, total)}`);
    md.appendMarkdown(lines.join('  \n'));
    md.appendMarkdown(`\n\n共 ${total} 次提交`);
  } else {
    md.appendMarkdown('暂无提交统计');
  }
  return md;
}

/** Fetch the current user's status (0=AC, -10=never, else last verdict) for internal pids, chunked. */
async function fetchStatusMap(auth: AuthManager, pids: any[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const ids = Array.from(new Set(pids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)));
  if (!ids.length) return map;
  try {
    if (!(await auth.ensureLoggedIn(false))) return map;
  } catch {
    return map;
  }
  const chunk = 300;
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    try {
      const res = await auth.api.getUserProblemStatus(part);
      for (const key of Object.keys(res || {})) {
        const v: any = (res as any)[key];
        const status = v && typeof v === 'object' ? v.status : v;
        map.set(Number(key), Number(status));
      }
    } catch {
      /* ignore this chunk */
    }
  }
  return map;
}

/** Mark a tree item with the user's AC/attempted state. */
function applyStatusVisual(item: vscode.TreeItem, status?: number): void {
  if (status === undefined) return;
  if (status === 0) {
    item.iconPath = new vscode.ThemeIcon('pass-filled');
    item.description = '✓';
  } else if (status === -10) {
    // never submitted: leave the difficulty icon, no badge
  } else {
    item.iconPath = new vscode.ThemeIcon('circle-large-outline');
    item.description = '未通过';
  }
}

export class ProblemsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private items: vscode.TreeItem[] = [];
  private notice: string | undefined = '登录后点击刷新或搜索题目。';
  public keyword = '';

  constructor(private auth: AuthManager) {}

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  async load(keyword?: string): Promise<void> {
    if (keyword !== undefined) this.keyword = keyword;
    if (!(await this.auth.ensureLoggedIn(false))) {
      this.items = [];
      this.notice = '未登录。点击上方登录按钮。';
      this.refresh();
      return;
    }
    try {
      // The server caps `limit` at 500, so page through and fetch the whole list.
      const size = 500;
      let currentPage = 1;
      let pages = 1;
      const all: any[] = [];
      do {
        const page = await this.auth.api.getProblemList({
          currentPage,
          limit: size,
          keyword: this.keyword || undefined,
        });
        all.push(...(page.records || []));
        pages = page.pages || 1;
        currentPage++;
      } while (currentPage <= pages && currentPage <= 50);
      const statusMap = await fetchStatusMap(this.auth, all.map((p: any) => p.pid));
      this.items = all.map((p: any) => this.makeItem(p, statusMap.get(Number(p.pid))));
      this.notice = this.items.length ? undefined : '没有找到题目。';
    } catch (e: any) {
      this.items = [];
      this.notice = `加载题目失败：${e?.message ?? e}`;
    }
    this.refresh();
  }

  private makeItem(p: any, status?: number): vscode.TreeItem {
    const label = `${p.problemId}  ${p.title}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.tooltip = buildProblemTooltip(p);
    item.contextValue = 'problem';
    item.iconPath = new vscode.ThemeIcon(p.difficulty && p.difficulty >= 3 ? 'flame' : 'symbol-method');
    applyStatusVisual(item, status);
    item.command = {
      command: 'nuaaOj.openProblem',
      title: '打开题目',
      arguments: [p.problemId],
    };
    return item;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (this.items.length) return this.items;
    if (this.notice) {
      const n = new vscode.TreeItem(this.notice, vscode.TreeItemCollapsibleState.None);
      n.iconPath = new vscode.ThemeIcon('info');
      return [n];
    }
    return [];
  }
}

export class SubmissionsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private items: vscode.TreeItem[] = [];
  private notice: string | undefined = '登录后点击刷新查看提交记录。';

  constructor(private auth: AuthManager) {}

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  async load(): Promise<void> {
    if (!(await this.auth.ensureLoggedIn(false))) {
      this.items = [];
      this.notice = '未登录。';
      this.refresh();
      return;
    }
    try {
      const page = await this.auth.api.getSubmissionList({ limit: 50, currentPage: 1, onlyMine: true });
      this.items = (page.records || []).map((r: any) => this.makeItem(r));
      this.notice = this.items.length ? undefined : '暂无提交记录。';
    } catch (e: any) {
      this.items = [];
      this.notice = `加载提交记录失败：${e?.message ?? e}`;
    }
    this.refresh();
  }

  private makeItem(r: any): vscode.TreeItem {
    const st = statusMeta(r.status);
    const label = `${st.short}  ${r.displayPid ?? r.pid}  ${r.title}`;
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    const when = r.submitTime ? new Date(r.submitTime).toLocaleString() : '';
    item.description = `${r.time ?? '-'}ms  ${r.memory ?? '-'}KB`;
    item.tooltip = `${st.name}\n题目：${r.title}（${r.displayPid ?? r.pid}）\n语言：${r.language ?? '-'}\n时间：${when}\n提交号：${r.submitId}`;
    item.contextValue = 'submission';
    item.iconPath = new vscode.ThemeIcon(statusIcon(st.short));
    if (r.displayPid) {
      item.command = {
        command: 'nuaaOj.openProblem',
        title: '打开题目',
        arguments: [String(r.displayPid)],
      };
    }
    return item;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (this.items.length) return this.items;
    if (this.notice) {
      const n = new vscode.TreeItem(this.notice, vscode.TreeItemCollapsibleState.None);
      n.iconPath = new vscode.ThemeIcon('info');
      return [n];
    }
    return [];
  }
}

/** Sidebar view of the currently opened problem, including a clickable language row. */
export class CurrentProblemProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private ctx: ProblemContext | undefined;

  setContext(ctx: ProblemContext | undefined): void {
    this.ctx = ctx;
    this._onDidChange.fire(undefined);
  }

  get current(): ProblemContext | undefined {
    return this.ctx;
  }

  refresh(): void {
    this._onDidChange.fire(undefined);
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  getChildren(): vscode.TreeItem[] {
    if (!this.ctx) {
      const n = new vscode.TreeItem('尚未打开题目', vscode.TreeItemCollapsibleState.None);
      n.iconPath = new vscode.ThemeIcon('info');
      n.description = '打开题目后在此选择语言';
      return [n];
    }
    const ctx = this.ctx;
    const defaultLang = vscode.workspace.getConfiguration('nuaaOj').get<string>('defaultLanguage', 'C++');
    const fileLang = ctx.solutionFile ? extensionToLanguage(path.extname(ctx.solutionFile).toLowerCase()) : undefined;
    const effective = submissionLanguage(ctx, ctx.solutionFile || '') || pickLanguage(ctx, fileLang, defaultLang);
    const locked = isLanguageLocked(ctx);
    const langAllowed = !ctx.allowedLanguages || !ctx.allowedLanguages.length || ctx.allowedLanguages.includes(effective);

    const title = new vscode.TreeItem(`${ctx.displayId}  ${ctx.title}`, vscode.TreeItemCollapsibleState.None);
    title.iconPath = new vscode.ThemeIcon('book');
    title.command = { command: 'nuaaOj.showProblem', title: '显示题目' };
    title.tooltip = ctx.url;

    const lang = new vscode.TreeItem(`语言：${effective}`, vscode.TreeItemCollapsibleState.None);
    lang.iconPath = new vscode.ThemeIcon(locked ? 'lock' : !langAllowed ? 'warning' : 'symbol-color');
    lang.description = locked ? '（该题锁定）' : !langAllowed ? '（当前文件语言被禁止）' : '点击切换';
    lang.tooltip = locked
      ? `该题只允许 ${effective}，已锁定`
      : !langAllowed
        ? `当前文件语言 ${effective} 被禁止；可用语言：${(ctx.allowedLanguages || []).join(', ')}`
        : `可用语言：${(ctx.allowedLanguages || []).join(', ') || '全部'}`;
    lang.contextValue = 'language';
    if (!locked) {
      lang.command = { command: 'nuaaOj.selectLanguage', title: '选择语言' };
    }

    const file = new vscode.TreeItem(`文件：${ctx.solutionFile || '(未创建)'}`, vscode.TreeItemCollapsibleState.None);
    file.iconPath = new vscode.ThemeIcon('file-code');
    file.command = { command: 'nuaaOj.showProblem', title: '打开题目' };

    const limits = new vscode.TreeItem(`限制：${ctx.timeLimit} ms / ${ctx.memoryLimit} MB`, vscode.TreeItemCollapsibleState.None);
    limits.iconPath = new vscode.ThemeIcon('dashboard');
    if (ctx.isFileIO) limits.description = '文件IO';

    return [title, lang, file, limits];
  }
}

/** Training packages shown as nested folders: category → training → problems. */
export class TrainingProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private trainings: any[] | undefined;
  private problemsCache = new Map<number, any[]>();

  constructor(private auth: AuthManager) {}

  refresh(): void {
    this.trainings = undefined;
    this.problemsCache.clear();
    this._onDidChange.fire(undefined);
  }

  async load(): Promise<void> {
    this.trainings = undefined;
    this.problemsCache.clear();
    try {
      if (!(await this.auth.ensureLoggedIn(false))) {
        this.trainings = [];
        this._onDidChange.fire(undefined);
        return;
      }
      const page = await this.auth.api.getTrainingList({ currentPage: 1, limit: 500 });
      this.trainings = page.records || [];
    } catch {
      this.trainings = [];
    }
    this._onDidChange.fire(undefined);
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!el) return this.rootChildren();
    const kind = (el as any).kind;
    if (kind === 'category') return ((el as any).trainings as any[]).map((t) => this.trainingItem(t));
    if (kind === 'training') return this.problemChildren(Number((el as any).tid));
    return [];
  }

  private notice(text: string, command?: string): vscode.TreeItem {
    const n = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
    n.iconPath = new vscode.ThemeIcon('info');
    if (command) n.command = { command, title: text };
    return n;
  }

  private async rootChildren(): Promise<vscode.TreeItem[]> {
    if (!(await this.auth.ensureLoggedIn(false))) {
      return [this.notice('未登录 — 点击登录', 'nuaaOj.login')];
    }
    if (this.trainings === undefined) {
      try {
        const page = await this.auth.api.getTrainingList({ currentPage: 1, limit: 500 });
        this.trainings = page.records || [];
      } catch (e: any) {
        this.trainings = [];
        return [this.notice(`加载训练题单失败：${e?.message ?? e}`)];
      }
    }
    const list = this.trainings || [];
    if (!list.length) return [this.notice('没有可访问的训练题单。')];

    // Group by category; fall back to a flat list when there's only one category.
    const groups = new Map<string, any[]>();
    for (const t of list) {
      const key = (t.categoryName || '未分类').trim() || '未分类';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    if (groups.size <= 1) return list.map((t) => this.trainingItem(t));

    const items: vscode.TreeItem[] = [];
    for (const [name, arr] of groups) {
      const cat = new vscode.TreeItem(`${name}（${arr.length}）`, vscode.TreeItemCollapsibleState.Expanded);
      (cat as any).kind = 'category';
      (cat as any).trainings = arr;
      cat.iconPath = new vscode.ThemeIcon('folder');
      cat.contextValue = 'trainingCategory';
      items.push(cat);
    }
    return items;
  }

  private trainingItem(t: any): vscode.TreeItem {
    const item = new vscode.TreeItem(
      String(t.title || `训练 #${t.id}`),
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    (item as any).kind = 'training';
    (item as any).tid = t.id;
    item.iconPath = new vscode.ThemeIcon('folder-library');
    item.description = `${t.problemCount != null ? t.problemCount + ' 题' : ''}${t.categoryName ? ' · ' + t.categoryName : ''}`;
    item.tooltip = `${t.title}\n训练编号 #${t.id}${t.problemCount != null ? ' · ' + t.problemCount + ' 题' : ''}`;
    item.contextValue = 'training';
    return item;
  }

  private async problemChildren(tid: number): Promise<vscode.TreeItem[]> {
    let probs = this.problemsCache.get(tid);
    if (!probs) {
      try {
        probs = await this.auth.api.getTrainingProblemList(tid);
        this.problemsCache.set(tid, probs);
      } catch (e: any) {
        return [this.notice(`加载题目失败：${e?.message ?? e}`)];
      }
    }
    if (!probs.length) return [this.notice('该训练题单暂时没有题目。')];
    const base = vscode.workspace.getConfiguration('nuaaOj').get<string>('baseUrl', 'https://oj.nuaa.edu.cn').replace(/\/+$/, '');
    const statusMap = await fetchStatusMap(this.auth, probs.map((p: any) => p.pid));
    return probs.map((p: any) => {
      const it = new vscode.TreeItem(`${p.problemId}  ${p.title}`, vscode.TreeItemCollapsibleState.None);
      (it as any).kind = 'problem';
      it.iconPath = new vscode.ThemeIcon(p.difficulty && p.difficulty >= 3 ? 'flame' : 'symbol-method');
      it.tooltip = buildProblemTooltip(p);
      it.contextValue = 'trainingProblem';
      applyStatusVisual(it, statusMap.get(Number(p.pid)));
      it.command = {
        command: 'nuaaOj.openProblem',
        title: '打开题目',
        arguments: [`${base}/training/${tid}/problem/${p.problemId}`],
      };
      return it;
    });
  }
}

/** Homework (作业) from the recommendation "learning-map" API, shown as chapter folders. */
export class HomeworkProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private data: any | undefined;

  constructor(private auth: AuthManager) {}

  refresh(): void {
    this.data = undefined;
    this._onDidChange.fire(undefined);
  }

  async load(): Promise<void> {
    this.data = undefined;
    try {
      if (!(await this.auth.ensureLoggedIn(false))) {
        this.data = { __notLoggedIn: true };
      } else {
        const uid = this.userId();
        this.data = uid ? await this.auth.api.getLearningMap(uid) : { __error: '无法确定用户 ID' };
      }
    } catch (e: any) {
      this.data = { __error: e?.message ?? String(e) };
    }
    this._onDidChange.fire(undefined);
  }

  private userId(): string {
    const override = vscode.workspace.getConfiguration('nuaaOj').get<string>('recommendation.userId', '');
    if (override && override.trim()) return override.trim();
    const u: any = this.auth.currentUser;
    return u?.username || u?.number || '';
  }

  getTreeItem(el: vscode.TreeItem): vscode.TreeItem {
    return el;
  }

  private notice(text: string, command?: string): vscode.TreeItem {
    const n = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
    n.iconPath = new vscode.ThemeIcon('info');
    if (command) n.command = { command, title: text };
    return n;
  }

  async getChildren(el?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!el) return this.rootChildren();
    const kind = (el as any).kind;
    if (kind === 'stage') {
      const hw: any[] = (el as any).hw || [];
      const pr: any[] = (el as any).pr || [];
      const out: vscode.TreeItem[] = hw.map((p) => this.problemItem(p));
      if (pr.length) {
        const folder = new vscode.TreeItem(`练习（${pr.length}）`, vscode.TreeItemCollapsibleState.Collapsed);
        (folder as any).kind = 'practice';
        (folder as any).items = pr;
        folder.iconPath = new vscode.ThemeIcon('folder');
        out.push(folder);
      }
      return out.length ? out : [this.notice('本章暂无作业')];
    }
    if (kind === 'practice') {
      return ((el as any).items as any[]).map((p) => this.problemItem(p));
    }
    return [];
  }

  private async rootChildren(): Promise<vscode.TreeItem[]> {
    if (!(await this.auth.ensureLoggedIn(false))) return [this.notice('未登录 — 点击登录', 'nuaaOj.login')];
    if (this.data === undefined) {
      try {
        const uid = this.userId();
        this.data = uid ? await this.auth.api.getLearningMap(uid) : { __error: '无法确定用户 ID' };
      } catch (e: any) {
        this.data = { __error: e?.message ?? String(e) };
      }
    }
    const d = this.data;
    if (d?.__notLoggedIn) return [this.notice('未登录 — 点击登录', 'nuaaOj.login')];
    if (d?.__error) return [this.notice(`加载作业失败：${d.__error}`)];

    const kp = d?.knowledge_problems || {};
    const prog = d?.student_progress || {};
    const current = d?.course?.current_topic;
    const stages: any[] = Array.isArray(d?.stages) ? d.stages : [];

    const items: vscode.TreeItem[] = [];
    const seen = new Set<string>();
    const makeStage = (name: string, label: string, hw: any[], pr: any[]) => {
      const p = prog[name] || {};
      const total = p.homework_total != null ? p.homework_total : hw.length;
      const pass = p.homework_pass != null ? p.homework_pass : hw.filter((x) => x.ac).length;
      items.push(this.stageItem(name, label, hw, pr, pass, total, current === name));
    };
    for (const st of stages) {
      const name = st?.name || st?.id;
      if (!name || seen.has(name)) continue;
      const hw = (kp[name]?.homework as any[]) || [];
      const pr = (kp[name]?.practice as any[]) || [];
      if (!hw.length && !pr.length) continue;
      seen.add(name);
      makeStage(name, st.label || name, hw, pr);
    }
    for (const name of Object.keys(kp)) {
      if (seen.has(name)) continue;
      const hw = (kp[name]?.homework as any[]) || [];
      const pr = (kp[name]?.practice as any[]) || [];
      if (!hw.length && !pr.length) continue;
      const label = hw[0]?.knowledge_sources?.[0]?.label || pr[0]?.knowledge_sources?.[0]?.label || name;
      makeStage(name, label, hw, pr);
    }
    if (!items.length) return [this.notice('当前课程暂无作业。')];
    return items;
  }

  private stageItem(
    name: string,
    label: string,
    hw: any[],
    pr: any[],
    pass: number,
    total: number,
    isCurrent: boolean,
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    (item as any).kind = 'stage';
    (item as any).hw = hw;
    (item as any).pr = pr;
    item.iconPath = new vscode.ThemeIcon(isCurrent ? 'folder-active' : 'folder');
    const parts: string[] = [];
    if (isCurrent) parts.push('当前');
    parts.push(`作业 ${pass}/${total}`);
    if (pr.length) parts.push(`练习 ${pr.length}`);
    item.description = parts.join(' · ');
    item.tooltip = `${label}\n作业通过 ${pass}/${total}${pr.length ? ` · 练习 ${pr.length} 题` : ''}`;
    item.contextValue = 'homeworkStage';
    return item;
  }

  private problemItem(p: any): vscode.TreeItem {
    const base = vscode.workspace.getConfiguration('nuaaOj').get<string>('baseUrl', 'https://oj.nuaa.edu.cn').replace(/\/+$/, '');
    const unavailable = p.unavailable === true || p.entry_allowed === false;
    const item = new vscode.TreeItem(`${p.problem_id}  ${p.title}`, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(unavailable ? 'lock' : p.ac ? 'pass-filled' : p.attempted ? 'circle-large-outline' : 'circle-outline');
    item.description = unavailable ? '不可用' : p.ac ? '✓' : p.attempted ? '未通过' : '';
    item.tooltip = `${p.title}\n编号 ${p.problem_id}${p.ac ? '\n已通过' : p.attempted ? '\n已尝试未通过' : ''}`;
    item.contextValue = 'homeworkProblem';
    if (!unavailable) {
      item.command = { command: 'nuaaOj.openProblem', title: '打开题目', arguments: [String(p.problem_id)] };
    }
    return item;
  }
}

function statusIcon(short: string): string {
  switch (short) {
    case 'AC':
      return 'pass-filled';
    case 'WA':
    case 'TLE':
    case 'MLE':
    case 'RE':
    case 'SE':
      return 'error';
    case 'CE':
    case 'PA':
      return 'warning';
    case 'PD':
    case 'CP':
    case 'JG':
    case 'SB':
      return 'sync';
    default:
      return 'circle-outline';
  }
}
