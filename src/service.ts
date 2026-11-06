import * as vscode from 'vscode';
import * as path from 'path';
import { AuthManager } from './auth';
import { OjError } from './api';
import { RecordsPanel } from './recordsPanel';
import { AssistantPanel } from './assistantPanel';
import { ProfilePanel } from './profilePanel';
import { SettingsPanel } from './settingsPanel';
import { UserHomePanel } from './userHomePanel';
import { MessagesPanel } from './messagesPanel';
import { LearningPanel } from './learningPanel';
import { LearningMapPanel } from './learningMapPanel';
import {
  ProblemContext,
  buildContext,
  ensureTempRoot,
  extensionToLanguage,
  hasWorkspaceFolder,
  isLanguageLocked,
  languageToExtension,
  loadContextForFile,
  pickLanguage,
  problemFolderUri,
  saveContext,
  submissionLanguage,
} from './context';
import { extractTemplateCode } from './codeExtract';
import { resolveCCompiler, resolveCppCompiler } from './toolchain';
import { ProblemDetail } from './types';
import { ProblemPanel, ProblemPanelHost } from './problemPanel';
import { InitialState } from './statement';
import { CaseResult, CaseStatus, RunResult, RunnerConfig, isLocallyRunnable, runSamples } from './runner';
import { statusMeta } from './status';

export interface ParsedTarget {
  kind: 'problem' | 'training' | 'contest';
  displayId: string;
  tid?: number;
  cid?: number;
}

export function parseTarget(input: string): ParsedTarget | undefined {
  const s = (input || '').trim();
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex((p) => p === 'problem');
      if (idx >= 0 && parts[idx + 1]) {
        // /training/:tid/problem/:id or /contest/:cid/problem/:id or /problem/:id
        const before = parts.slice(0, idx);
        const displayId = decodeURIComponent(parts[idx + 1]);
        if (before[0] === 'training' && before[1]) return { kind: 'training', displayId, tid: Number(before[1]) };
        if (before[0] === 'contest' && before[1]) return { kind: 'contest', displayId, cid: Number(before[1]) };
        return { kind: 'problem', displayId };
      }
      // Maybe a bare URL to /problem/E1 handled above; else try last segment.
      const last = parts[parts.length - 1];
      if (last) return { kind: 'problem', displayId: decodeURIComponent(last) };
      return undefined;
    } catch {
      return undefined;
    }
  }
  // plain id like E1, 9999, CPP2-4
  return { kind: 'problem', displayId: s };
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export class NuaaOjService implements ProblemPanelHost {
  constructor(
    private auth: AuthManager,
    private output: vscode.OutputChannel,
    private context: vscode.ExtensionContext,
    private extensionUri: vscode.Uri,
    private onDataChanged: () => void,
  ) {}

  private tempNotified = false;
  private testHistory = new Map<string, any[]>();

  private historyKey(ctx: ProblemContext): string {
    return `${ctx.kind}:${ctx.tid ?? 0}:${ctx.displayId}`;
  }

  private recordTest(ctx: ProblemContext, kind: string, result: RunResult): void {
    if (result.skipped) return;
    const key = this.historyKey(ctx);
    const arr = this.testHistory.get(key) || [];
    const passed = result.cases.filter((c) => c.status === 'AC' || c.status === 'OK').length;
    arr.unshift({ at: Date.now(), kind, language: result.language, passed, total: result.cases.length, ok: result.ok });
    this.testHistory.set(key, arr.slice(0, 50));
  }

  // ---- RecordsPanel host -----------------------------------------------------
  async fetchSubmissions(ctx: ProblemContext, onlyMine: boolean): Promise<{ records: any[]; total: number }> {
    if (!(await this.auth.ensureLoggedIn())) return { records: [], total: 0 };
    const page = await this.auth.api.getSubmissionList({
      limit: 100,
      currentPage: 1,
      onlyMine,
      problemID: ctx.displayId,
      completeProblemID: true,
    });
    return { records: page.records || [], total: page.total || 0 };
  }

  async getTestHistory(ctx: ProblemContext): Promise<any[]> {
    return this.testHistory.get(this.historyKey(ctx)) || [];
  }

  async getSubmissionDetail(submitId: number): Promise<any> {
    return this.auth.api.getSubmissionDetail(submitId);
  }

  async getCaseResults(submitId: number): Promise<any[]> {
    try {
      const r = await this.auth.api.getAllCaseResult(submitId);
      return (r?.judgeCaseList as any[]) || (r?.subTaskJudgeCaseList as any[]) || [];
    } catch {
      return [];
    }
  }

  /** Load a submission's own code and write it into the solution file (with confirmation). */
  async applySubmission(ctx: ProblemContext, submitId: number): Promise<void> {
    if (!(await this.auth.ensureLoggedIn())) return;
    let d: any;
    try {
      d = await this.auth.api.getSubmissionDetail(submitId);
    } catch (e: any) {
      vscode.window.showWarningMessage(`获取提交代码失败：${e?.message ?? e}`);
      return;
    }
    const code = d?.submission?.code || '';
    if (!d?.canViewCode || !String(code).trim()) {
      vscode.window.showWarningMessage('该提交的代码不可查看，无法覆盖到源文件。');
      return;
    }
    const res = await this.applyCodeToSolution(ctx, String(code), d.submission.language || '');
    if (res.ok) vscode.window.showInformationMessage(res.message || '已覆盖到源文件。');
    else if (!res.cancelled) vscode.window.showWarningMessage(res.message || '覆盖失败。');
  }

  /** Write `code` into the solution file for `language` (switch file if the language differs), after confirm. */
  async applyCodeToSolution(
    ctx: ProblemContext,
    code: string,
    language: string,
  ): Promise<{ ok: boolean; message?: string; cancelled?: boolean; fileName?: string; language?: string; switched?: boolean }> {
    let fileUri = await this.getSolutionUri(ctx);
    if (!fileUri) return { ok: false, message: '未找到对应的代码文件。' };
    const currentLang = extensionToLanguage(path.extname(fileUri.fsPath).toLowerCase());
    const targetLang = language || currentLang || '';
    let switched = false;

    if (targetLang && currentLang && targetLang !== currentLang) {
      if (ctx.allowedLanguages && ctx.allowedLanguages.length && !ctx.allowedLanguages.includes(targetLang)) {
        return { ok: false, message: `该提交语言「${targetLang}」不在本题允许的语言内。` };
      }
      const targetName = `${ctx.displayId}${languageToExtension(targetLang)}`;
      const go = await vscode.window.showWarningMessage(
        `该提交使用「${targetLang}」，与当前文件语言「${currentLang}」不同。\n将切换到「${targetName}」并用该提交代码覆盖它，确定吗？`,
        { modal: true },
        '切换并覆盖',
      );
      if (go !== '切换并覆盖') return { ok: false, cancelled: true };
      const sw = await this.changeLanguageAndCreateFile(ctx, targetLang);
      if (!sw.ok) return { ok: false, message: sw.message || '切换语言失败。' };
      fileUri = (await this.getSolutionUri(ctx)) || fileUri;
      switched = true;
    } else {
      const name = path.basename(fileUri.fsPath);
      const go = await vscode.window.showWarningMessage(
        `将用该提交的代码覆盖当前文件「${name}」${targetLang ? `（语言：${targetLang}）` : ''}。现有内容会被替换，确定吗？`,
        { modal: true },
        '覆盖',
      );
      if (go !== '覆盖') return { ok: false, cancelled: true };
    }

    await this.saveDocument(fileUri);
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), code);
      if (await vscode.workspace.applyEdit(edit)) await doc.save();
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
    } catch (e: any) {
      return { ok: false, message: `写入文件失败：${e?.message ?? e}` };
    }
    const fileName = path.basename(fileUri.fsPath);
    return { ok: true, message: switched ? `已切换到 ${targetLang} 并写入该提交代码「${fileName}」。` : `已把该提交代码写入「${fileName}」。`, fileName, language: targetLang, switched };
  }

  copyText(text: string): void {
    void vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage('已复制代码到剪贴板', 2000);
  }

  submissionUrl(submitId: number): string {
    return `${this.base()}/submission-detail/${submitId}`;
  }

  async openRecords(ctx: ProblemContext, tab: 'my' | 'all' | 'test'): Promise<void> {
    await RecordsPanel.show(ctx, this, this.extensionUri, tab);
  }

  // ---- AI assistant ---------------------------------------------------------
  private assistantUser(): string | undefined {
    return this.auth.currentUser?.username;
  }

  async getContext(ctx: ProblemContext): Promise<any> {
    const u = this.assistantUser();
    if (!u) return null;
    if (!ctx.displayId) return null;
    return this.auth.api.assistantContext(u, ctx.displayId);
  }

  async getSessions(): Promise<any[]> {
    const u = this.assistantUser();
    if (!u) return [];
    return this.auth.api.assistantSessions(u);
  }

  async getSession(sessionId: string): Promise<any[]> {
    const u = this.assistantUser();
    if (!u) return [];
    return this.auth.api.assistantSession(u, sessionId);
  }

  async ask(
    ctx: ProblemContext,
    question: string,
    sessionId: string,
    onEvent: (ev: any) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const u = this.assistantUser();
    if (!u) throw new OjError('请先登录。');
    const payload: any = { question, session_id: sessionId || '', action: 'ask', activity_type: '', activity_id: '', group_id: '' };
    if (ctx.displayId) {
      payload.problem_id = ctx.displayId;
      payload.require_guided = true;
    } else {
      payload.require_guided = false;
    }
    return this.auth.api.assistantAskStream(u, payload, onEvent, signal);
  }

  async openAssistant(ctx: ProblemContext): Promise<void> {
    if (!(await this.auth.ensureLoggedIn())) return;
    await AssistantPanel.show(ctx, this, this.extensionUri);
  }

  /** General assistant (no problem context) — reuses AssistantPanel; keeps session history. */
  async openAssistantGeneral(): Promise<void> {
    if (!(await this.auth.ensureLoggedIn())) return;
    const ctx: any = {
      kind: 'general', displayId: '', title: '', tid: 0, timeLimit: 1000, memoryLimit: 256,
      isFileIO: false, samples: [], allowedLanguages: [], url: '',
    };
    await AssistantPanel.show(ctx, this, this.extensionUri);
  }

  // ---- Ability profile ------------------------------------------------------
  async profile(): Promise<any> {
    const u = this.assistantUser();
    if (!u) return null;
    return this.auth.api.studentProfile(u);
  }

  async advice(kind: 'knowledge' | 'method', onEvent: (ev: any) => void, signal: AbortSignal): Promise<void> {
    const u = this.assistantUser();
    if (!u) throw new OjError('请先登录。');
    return kind === 'knowledge'
      ? this.auth.api.adviceKnowledgeStream(u, onEvent, signal)
      : this.auth.api.adviceMethodStream(u, onEvent, signal);
  }

  async openProfile(): Promise<void> {
    if (!(await this.auth.ensureLoggedIn())) return;
    await ProfilePanel.show(this, this.extensionUri);
  }

  // ---- Learning path (学径) -------------------------------------------------
  async data(): Promise<any> {
    const u = this.assistantUser();
    if (!u) throw new OjError('请先登录。');
    const [overview, topic] = await Promise.all([
      this.auth.api.getLearningOverview(u),
      this.auth.api.getCourseCurrentTopic().catch(() => null),
    ]);
    return { overview, topic };
  }

  async openLearning(): Promise<void> {
    if (!(await this.auth.ensureLoggedIn())) return;
    await LearningPanel.show(this, this.extensionUri);
  }

  async openLearningMap(): Promise<void> {
    if (!(await this.auth.ensureLoggedIn())) return;
    await LearningMapPanel.show(this, this.extensionUri);
  }

  // ---- Settings: profile / account -----------------------------------------
  private settingsInfo(): any {
    const u: any = this.auth.currentUser;
    if (!u) return null;
    return {
      username: u.username,
      email: u.email,
      avatar: this.absoluteUrl(u.avatar),
      realname: u.realname,
      nickname: u.nickname,
      school: u.school,
      number: u.number,
      cfUsername: u.cfUsername,
      blog: u.blog,
      github: u.github,
      gender: u.gender,
      signature: u.signature,
    };
  }

  private applyUserInfo(vo: any): void {
    const u: any = this.auth.currentUser;
    if (!u || !vo || typeof vo !== 'object') return;
    for (const k of ['nickname', 'avatar', 'email', 'number', 'gender', 'school', 'signature', 'realname', 'github', 'blog', 'cfUsername']) {
      if (vo[k] !== undefined && vo[k] !== null) u[k] = vo[k];
    }
  }

  getInfo(): any {
    return this.settingsInfo();
  }

  async saveInfo(fields: any): Promise<any> {
    const clean: any = {};
    for (const k of Object.keys(fields || {})) {
      const v = fields[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') clean[k] = v;
    }
    if (!clean.gender) clean.gender = 'secrecy';
    const vo = await this.auth.api.changeUserInfo(clean);
    this.applyUserInfo(vo);
    this.onDataChanged();
    return this.settingsInfo();
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<any> {
    return this.auth.api.changePassword(oldPassword, newPassword);
  }

  private lastEmailCodeAt = 0;
  async sendEmailCode(email: string): Promise<any> {
    const now = Date.now();
    if (now - this.lastEmailCodeAt < 60000) {
      throw new OjError('发送过于频繁，请 60 秒后再试。');
    }
    this.lastEmailCodeAt = now;
    try {
      return await this.auth.api.getChangeEmailCode(email);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/server error|servlet|internal|500/i.test(msg)) {
        throw new OjError('学校邮件服务当前异常（server error），验证码很可能发不出去。请稍后再试或联系管理员。');
      }
      throw e;
    }
  }

  /** After password change: prompt re-login, log out, and open the login view. */
  passwordChanged(): void {
    void (async () => {
      await vscode.window.showInformationMessage('密码修改成功，请重新登录。', { modal: true }, '重新登录');
      await this.auth.logout();
      this.onDataChanged();
      void vscode.commands.executeCommand('nuaaOj.login');
    })();
  }

  async changeEmail(password: string, newEmail: string, code: string): Promise<any> {
    const vo = await this.auth.api.changeEmail(password, newEmail, code);
    this.applyUserInfo(vo);
    this.onDataChanged();
    return this.settingsInfo();
  }

  async uploadAvatar(dataUrl: string): Promise<any> {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUrl || ''));
    if (!m) throw new OjError('头像数据无效。');
    const mime = m[1];
    const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const buf = Buffer.from(m[2], 'base64');
    const r = await this.auth.api.uploadAvatar(buf, mime, `avatar.${ext}`);
    if (r && typeof r === 'object') {
      this.applyUserInfo(r);
      this.onDataChanged();
      if ((r as any).avatar) return this.absoluteUrl((r as any).avatar);
    }
    if (typeof r === 'string') return this.absoluteUrl(r);
    return this.absoluteUrl((this.auth.currentUser as any)?.avatar);
  }

  async openSettings(): Promise<void> {
    if (!(await this.auth.ensureLoggedIn())) return;
    await SettingsPanel.show(this, this.extensionUri);
  }

  openExtensionSettings(): void {
    void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:buger.nuaa-oj');
  }

  // ---- User home ------------------------------------------------------------
  async info(uid: string, username: string): Promise<any> {
    const v = await this.auth.api.getUserHomeInfo(uid, username);
    if (v && v.avatar) v.avatar = this.absoluteUrl(v.avatar);
    return v;
  }

  async heatmap(uid: string, username: string): Promise<any> {
    return this.auth.api.getUserCalendarHeatmap(uid, username);
  }

  async submissions(username: string, page: number, size: number): Promise<{ records: any[]; total: number }> {
    const r = await this.auth.api.getSubmissionList({ limit: size, currentPage: page, username, onlyMine: false });
    return { records: r.records || [], total: r.total || 0 };
  }

  async openUserHome(uid: string, username: string): Promise<void> {
    if (!(await this.auth.ensureLoggedIn())) return;
    await UserHomePanel.show(this, this.extensionUri, uid, username);
  }

  async openMyHome(): Promise<void> {
    if (!(await this.auth.ensureLoggedIn())) return;
    const u: any = this.auth.currentUser;
    if (!u) return;
    await UserHomePanel.show(this, this.extensionUri, u.uid, u.username);
  }

  async openSubmission(submitId: number): Promise<void> {
    await RecordsPanel.showDetail(this, this.extensionUri, submitId);
  }

  // ---- Messages (system notifications) -------------------------------------
  async list(page: number, size: number): Promise<{ records: any[]; total: number }> {
    const r = await this.auth.api.getSysMsgList({ currentPage: page, limit: size });
    return { records: r.records || [], total: r.total || 0 };
  }

  async openMessages(): Promise<void> {
    if (!(await this.auth.ensureLoggedIn())) return;
    await MessagesPanel.show(this, this.extensionUri);
  }

  private base(): string {
    return vscode.workspace.getConfiguration('nuaaOj').get<string>('baseUrl', 'https://oj.nuaa.edu.cn').replace(/\/+$/, '');
  }

  /** Turn a possibly-relative asset URL (e.g. /api/public/img/x.png) into an absolute OJ URL. */
  private absoluteUrl(u?: string): string | undefined {
    if (!u) return u;
    const s = String(u);
    if (/^https?:\/\//i.test(s) || /^data:/i.test(s)) return s;
    const b = this.base();
    return s.startsWith('/') ? b + s : b + '/' + s;
  }

  // ---- Opening a problem ----------------------------------------------------
  async openProblem(input: string): Promise<ProblemContext | undefined> {
    const target = parseTarget(input);
    if (!target) {
      vscode.window.showErrorMessage('无法识别的题目编号或链接。');
      return undefined;
    }
    if (target.kind === 'contest') {
      const go = await vscode.window.showWarningMessage(
        '暂不支持直接打开比赛题目（比赛需要先注册，且比赛题提交规则不同）。',
        '在浏览器打开',
      );
      if (go) {
        const url = `${this.base()}/contest/${target.cid}/problem/${target.displayId}`;
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
      return undefined;
    }
    if (!(await this.auth.ensureLoggedIn())) return undefined;

    try {
      const detail = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `正在获取题目 ${target.displayId}…` },
        () => this.fetchDetail(target),
      );
      const ctx = buildContext(target.kind, detail, this.base(), target.tid);
      const prepared = await this.prepareWorkspace(ctx, detail);
      if (!prepared) return undefined; // user cancelled file-naming prompt

      const shouldShow = vscode.workspace.getConfiguration('nuaaOj').get<boolean>('openStatementOnOpen', true);
      if (shouldShow) {
        await ProblemPanel.show(prepared, detail, this, this.extensionUri, true);
      }
      this.output.appendLine(
        `[open] ${prepared.kind} ${prepared.displayId} (pid=${prepared.pid}) "${prepared.title}" file=${prepared.solutionFile} samples=${prepared.samples.length} fileIO=${prepared.isFileIO} allowed=${(prepared.allowedLanguages || []).join('/') || 'all'}`,
      );
      return prepared;
    } catch (e: any) {
      this.reportError('获取题目失败', e);
      return undefined;
    }
  }

  async fetchDetailFor(ctx: ProblemContext): Promise<ProblemDetail> {
    return this.fetchDetail({ kind: ctx.kind, displayId: ctx.displayId, tid: ctx.tid });
  }

  private async fetchDetail(target: ParsedTarget): Promise<ProblemDetail> {
    if (target.kind === 'training' && target.tid) {
      return this.auth.api.getTrainingProblemDetail(target.displayId, target.tid);
    }
    return this.auth.api.getProblemDetail(target.displayId);
  }

  /**
   * Create the per-problem folder and a fresh solution file named after the problem id.
   * If that file already exists, ask the user for a new name (never overwrite, to avoid pollution).
   * Returns the prepared context, or undefined if the user cancels naming.
   */
  private async prepareWorkspace(ctx: ProblemContext, detail: ProblemDetail): Promise<ProblemContext | undefined> {
    await this.ensureRoot();
    const folder = problemFolderUri(ctx);
    if (!folder) {
      vscode.window.showWarningMessage('无法创建题目目录。');
      return ctx;
    }
    await vscode.workspace.fs.createDirectory(folder);

    // Preserve a previously chosen language if it is still allowed.
    const existing = await this.loadExisting(folder);
    if (existing?.selectedLanguage && (!ctx.allowedLanguages || ctx.allowedLanguages.includes(existing.selectedLanguage))) {
      ctx.selectedLanguage = existing.selectedLanguage;
    }

    const defaultLang = vscode.workspace.getConfiguration('nuaaOj').get<string>('defaultLanguage', 'C++');
    const language = pickLanguage(ctx, undefined, defaultLang);
    const created = await this.createSolutionFile(folder, ctx, language);
    if (!created) return undefined; // user cancelled naming

    ctx.solutionFile = created.fileName;
    ctx.language = extensionToLanguage(path.extname(created.fileName).toLowerCase()) || language;
    if (!ctx.selectedLanguage) ctx.selectedLanguage = language;
    ctx.samples = ctx.samples || [];
    await saveContext(folder, ctx);

    if (vscode.workspace.getConfiguration('nuaaOj').get<boolean>('autoCreateFile', true)) {
      const fileUri = vscode.Uri.joinPath(folder, created.fileName);
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
    }
    return ctx;
  }

  /** Ensure a usable root exists (workspace folder, or a random-UUID temp dir). */
  private async ensureRoot(): Promise<void> {
    if (!hasWorkspaceFolder()) {
      await ensureTempRoot();
      if (!this.tempNotified) {
        this.tempNotified = true;
        vscode.window.showInformationMessage('未打开文件夹：已在系统临时目录创建题目文件，退出 VS Code 后会自动清理。');
      }
    }
  }

  /**
   * Create a fresh solution file named after the problem id for `language`,
   * or reuse it directly if it already exists (resume writing, never overwrite).
   * Uses the problem's own code template (or code embedded in the description) if present,
   * otherwise creates an EMPTY file.
   */
  private async createSolutionFile(
    folder: vscode.Uri,
    ctx: ProblemContext,
    language: string,
  ): Promise<{ fileName: string } | undefined> {
    const ext = languageToExtension(language);
    const defaultName = `${ctx.displayId}${ext}`;
    const defaultUri = vscode.Uri.joinPath(folder, defaultName);

    // If the file already exists, just open it (resume) instead of creating a new one.
    if (await exists(defaultUri)) {
      return { fileName: defaultName };
    }

    const content = this.templateForContext(ctx, language);
    await vscode.workspace.fs.writeFile(defaultUri, Buffer.from(content, 'utf8'));
    return { fileName: defaultName };
  }

  /** Resolve the initial code for a new file: problem template → description code → empty. */
  private templateForContext(ctx: ProblemContext, language: string): string {
    const map = ctx.codeTemplates;
    if (map && typeof map === 'object') {
      let t = map[language];
      if (!t) {
        const key = Object.keys(map).find((k) => k.toLowerCase() === language.toLowerCase());
        if (key) t = map[key];
      }
      if (t && t.trim()) return t;
    }
    const extracted = extractTemplateCode(ctx.description, language);
    if (extracted && extracted.trim()) {
      // Only treat embedded code as a starter template for "fix/complete this program" style problems,
      // to avoid accidentally pre-filling illustrative example code from ordinary problems.
      const hint = `${ctx.title || ''} ${ctx.description || ''}`;
      if (/(改错|错误|改正|改为|修正|填空|待改错|修改.{0,6}程序|将.{0,12}改)/.test(hint)) {
        return extracted;
      }
    }
    return '';
  }

  /**
   * Switch submission language and create a fresh file for it (same logic as opening a problem).
   * Used by the language selector inside the problem panel.
   */
  async changeLanguageAndCreateFile(
    ctx: ProblemContext,
    language: string,
  ): Promise<{ ok: boolean; fileName?: string; language?: string; message?: string }> {
    if (isLanguageLocked(ctx) && language !== ctx.allowedLanguages?.[0]) {
      return { ok: false, message: `该题仅允许 ${ctx.allowedLanguages?.[0]}，已锁定。` };
    }
    if (ctx.allowedLanguages && ctx.allowedLanguages.length && !ctx.allowedLanguages.includes(language)) {
      return { ok: false, message: `该题不允许使用 ${language}。` };
    }
    await this.ensureRoot();
    const folder = problemFolderUri(ctx);
    if (!folder) return { ok: false, message: '无法定位题目文件夹。' };
    await vscode.workspace.fs.createDirectory(folder);

    ctx.selectedLanguage = language;
    const created = await this.createSolutionFile(folder, ctx, language);
    if (!created) return { ok: false, message: '已取消' };
    ctx.solutionFile = created.fileName;
    ctx.language = extensionToLanguage(path.extname(created.fileName).toLowerCase()) || language;
    await saveContext(folder, ctx);

    if (vscode.workspace.getConfiguration('nuaaOj').get<boolean>('autoCreateFile', true)) {
      const fileUri = vscode.Uri.joinPath(folder, created.fileName);
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
    }
    return { ok: true, fileName: created.fileName, language };
  }

  /** Host callback used by the problem panel's language selector. */
  async changeLanguage(
    ctx: ProblemContext,
    language: string,
  ): Promise<{ ok: boolean; fileName?: string; language?: string; message?: string }> {
    return this.changeLanguageAndCreateFile(ctx, language);
  }

  private async nextAvailableName(folder: vscode.Uri, displayId: string, ext: string): Promise<string> {
    for (let i = 2; i < 200; i++) {
      const name = `${displayId}-${i}${ext}`;
      if (!(await exists(vscode.Uri.joinPath(folder, name)))) return name;
    }
    return `${displayId}-${Date.now()}${ext}`;
  }

  private async loadExisting(folder: vscode.Uri): Promise<ProblemContext | undefined> {
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, '.nuaa-oj.json'));
      return JSON.parse(Buffer.from(raw).toString('utf8')) as ProblemContext;
    } catch {
      return undefined;
    }
  }

  private async findSourceFile(folder: vscode.Uri): Promise<string | undefined> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(folder);
      const src = entries.find(([name, type]) => type === vscode.FileType.File && extensionToLanguage(path.extname(name).toLowerCase()));
      return src?.[0];
    } catch {
      return undefined;
    }
  }

  // ---- Panel host -----------------------------------------------------------
  async getInitialState(ctx: ProblemContext): Promise<InitialState> {
    const fileUri = await this.getSolutionUri(ctx);
    const fileName = fileUri ? path.basename(fileUri.fsPath) : ctx.solutionFile || '';
    const fileLang = fileUri ? extensionToLanguage(path.extname(fileUri.fsPath).toLowerCase()) : undefined;
    const defaultLang = vscode.workspace.getConfiguration('nuaaOj').get<string>('defaultLanguage', 'C++');
    const effective = (fileUri ? submissionLanguage(ctx, fileUri.fsPath) : undefined) || pickLanguage(ctx, fileLang, defaultLang);
    const user = this.auth.currentUser;
    return {
      language: effective || '(未确定)',
      fileName: fileName || '(未创建)',
      loggedIn: !!user,
      user: user?.nickname || user?.username,
      baseUrl: this.base(),
      languageLocked: isLanguageLocked(ctx),
      allowedLanguages: ctx.allowedLanguages,
    };
  }

  async getSolutionUri(ctx: ProblemContext): Promise<vscode.Uri | undefined> {
    const folder = problemFolderUri(ctx);
    if (!folder) return undefined;
    // Prefer the active editor when it points into this problem's folder.
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === 'file') {
      const edir = vscode.Uri.joinPath(editor.document.uri, '..');
      if (edir.fsPath.toLowerCase() === folder.fsPath.toLowerCase()) {
        return editor.document.uri;
      }
    }
    if (ctx.solutionFile) {
      const u = vscode.Uri.joinPath(folder, ctx.solutionFile);
      if (await exists(u)) return u;
    }
    const found = await this.findSourceFile(folder);
    return found ? vscode.Uri.joinPath(folder, found) : undefined;
  }

  /** Save a file if it has unsaved edits. Safe to call for any file uri. */
  private async saveDocument(fileUri: vscode.Uri): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      if (doc.isDirty) await doc.save();
    } catch {
      /* ignore */
    }
  }

  /**
   * Inspect the currently active editor: if it points at a file inside a NUAA-OJ problem
   * folder and has a recognizable source extension, return the matching context + language.
   */
  async resolveActiveContext(
    target?: vscode.Uri,
  ): Promise<{ ctx: ProblemContext; fileUri: vscode.Uri; language: string; allowed: boolean } | undefined> {
    const uri = target ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') return undefined;
    const ctx = await loadContextForFile(uri);
    if (!ctx) return undefined;
    const ext = path.extname(uri.fsPath).toLowerCase();
    const language = extensionToLanguage(ext);
    if (!language) return undefined; // not a source file -> not a problem solution file
    ctx.solutionFile = path.basename(uri.fsPath);
    const allowed =
      !ctx.allowedLanguages || ctx.allowedLanguages.length === 0 || ctx.allowedLanguages.includes(language);
    return { ctx, fileUri: uri, language, allowed };
  }

  /** Update the user-selected language (ignored when the problem locks a single language). */
  async setLanguage(ctx: ProblemContext, language: string): Promise<{ ok: boolean; message?: string }> {
    if (isLanguageLocked(ctx)) {
      return { ok: false, message: `该题仅允许 ${ctx.allowedLanguages?.[0]}，已锁定。` };
    }
    if (ctx.allowedLanguages && ctx.allowedLanguages.length && !ctx.allowedLanguages.includes(language)) {
      return { ok: false, message: `该题不允许使用 ${language}。` };
    }
    ctx.selectedLanguage = language;
    const folder = problemFolderUri(ctx);
    if (folder) await saveContext(folder, ctx);
    return { ok: true };
  }

  private async runnerConfig(): Promise<RunnerConfig> {
    const c = vscode.workspace.getConfiguration('nuaaOj');
    const cComp = await resolveCCompiler(c.get<string>('compiler.c', ''));
    const cppComp = await resolveCppCompiler(c.get<string>('compiler.cpp', ''));
    this.output.appendLine(`[compiler] C=${cComp.command}(${cComp.source}) C++=${cppComp.command}(${cppComp.source})`);
    return {
      c: cComp.command,
      cArgs: c.get<string>('compiler.cArgs', ''),
      cpp: cppComp.command,
      cppArgs: c.get<string>('compiler.cppArgs', ''),
      java: c.get<string>('compiler.java', 'javac'),
      javaRun: c.get<string>('compiler.javaRun', 'java'),
      python: c.get<string>('compiler.python', process.platform === 'win32' ? 'python' : 'python3'),
      javascript: c.get<string>('compiler.javascript', 'node'),
      go: c.get<string>('compiler.go', 'go'),
      rust: c.get<string>('compiler.rust', 'rustc'),
      php: c.get<string>('compiler.php', 'php'),
      ruby: c.get<string>('compiler.ruby', 'ruby'),
      timeLimitExtraMs: c.get<number>('test.timeLimitExtraMs', 1000),
    };
  }

  async runTest(ctx: ProblemContext): Promise<RunResult> {
    const fileUri = await this.getSolutionUri(ctx);
    if (!fileUri) {
      return { ok: false, language: '', cases: [], totalTimeMs: 0, skipped: '未找到对应的代码文件。' };
    }
    // Make sure unsaved edits are written to disk before compiling.
    await this.saveDocument(fileUri);
    // Use the selected submission language (e.g. "C++ 20", "C++ With O2") so the local compiler
    // applies the matching -std / -O2, else fall back to the file extension's language.
    const extLang = extensionToLanguage(path.extname(fileUri.fsPath).toLowerCase()) || ctx.language || '';
    const language = submissionLanguage(ctx, fileUri.fsPath) || extLang;
    if (ctx.isFileIO && !ctx.samples.length) {
      return {
        ok: false,
        language,
        cases: [],
        totalTimeMs: 0,
        skipped:
          '该题为文件 IO 题且没有样例（如二进制文件题）：本地/在线调试都无法构造官方数据文件，请直接“提交代码”由云端用官方文件评测。',
      };
    }
    if (!isLocallyRunnable(language, fileUri.fsPath)) {
      return { ok: false, language, cases: [], totalTimeMs: 0, skipped: `当前语言 ${language} 暂不支持本地运行，请直接提交评测。` };
    }
    // Problems without samples: still allow a run with blank input (smoke test).
    const samples = ctx.samples.length ? ctx.samples : [{ input: '', output: '' }];
    // File-IO problems with samples: write sample content to the read file and read the write file.
    const fileIOopt = ctx.isFileIO
      ? { readFileName: ctx.ioReadFileName || 'input.txt', writeFileName: ctx.ioWriteFileName || 'output.txt' }
      : undefined;
    const result = await runSamples(
      fileUri.fsPath,
      language,
      samples,
      ctx.timeLimit,
      await this.runnerConfig(),
      (m) => this.output.appendLine(`[test] ${m}`),
      fileIOopt,
    );
    // A blank expected output means "no expected output" → label a clean run as OK, not WA.
    for (const c of result.cases) {
      if ((c.expected || '').trim() === '' && (c.status === 'WA' || c.status === 'AC')) c.status = 'OK';
    }
    result.ok = result.cases.every((c) => c.status === 'AC' || c.status === 'OK');
    this.recordTest(ctx, '本地测试', result);
    return result;
  }

  /**
   * Cloud sample test: run the current code on the OJ (online debug).
   * - Without `customInput`: runs all problem samples sequentially (rate-limited ~5s each, auto-retry).
   * - With `customInput`: runs only that custom input (single case, no expected output check).
   */
  async runCloudTest(ctx: ProblemContext, onProgress?: (text: string) => void, customInput?: string): Promise<RunResult> {
    const fileUri = await this.getSolutionUri(ctx);
    if (!fileUri) return { ok: false, language: '', cases: [], totalTimeMs: 0, skipped: '未找到对应的代码文件。' };
    await this.saveDocument(fileUri);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const code = doc.getText();
    if (!code.trim()) return { ok: false, language: '', cases: [], totalTimeMs: 0, skipped: '代码为空。' };
    const fileLang = extensionToLanguage(path.extname(fileUri.fsPath).toLowerCase());
    const language = submissionLanguage(ctx, fileUri.fsPath) || ctx.language || fileLang || '';
    if (!language) return { ok: false, language: '', cases: [], totalTimeMs: 0, skipped: '无法判断语言。' };
    const isCustom = customInput !== undefined;
    if (ctx.isFileIO && !isCustom && !ctx.samples.length) {
      return {
        ok: false,
        language,
        cases: [],
        totalTimeMs: 0,
        skipped:
          '该题为文件 IO 题且没有样例（如二进制文件题）：在线调试无法构造官方数据文件，请直接“提交代码”由云端用官方文件评测。',
      };
    }
    // File-IO problems WITH samples: the sample content is sent as the input file content (the server
    // writes it to ioReadFileName), matching the browser's online debug behaviour.
    const samples = isCustom
      ? [{ input: String(customInput ?? ''), output: '' }]
      : ctx.samples.length
        ? ctx.samples
        : [{ input: '', output: '' }];

    const interval = Math.max(0, vscode.workspace.getConfiguration('nuaaOj').get<number>('cloudTest.intervalMs', 5500));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const cases: CaseResult[] = [];
    const start = Date.now();
    let lastSubmit = 0;

    const submitWithRetry = async (input: string, expected: string): Promise<string> => {
      // Server rejects empty userInput; use a newline as the effective "blank" input.
      const sendInput = input.length === 0 ? '\n' : input;
      let waited = 0;
      for (;;) {
        try {
          return await this.auth.api.submitTestJudge({
            pid: ctx.pid,
            language,
            code,
            userInput: sendInput,
            expectedOutput: expected,
            type: 'public',
            isRemoteJudge: false,
          });
        } catch (e: any) {
          const msg = e instanceof OjError ? e.message : String(e?.message ?? e);
          if (/频繁|稍后|too (many|often)|rate/i.test(msg) && waited < 20000) {
            onProgress?.(`在线调试限流，等待重试…（已等 ${Math.round(waited / 1000)}s）`);
            await sleep(1500);
            waited += 1500;
            continue;
          }
          throw e;
        }
      }
    };

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if ((s.input || '').length > 1000) {
        cases.push({
          index: i + 1,
          input: s.input,
          expected: s.output,
          actual: '',
          stderr: '样例输入超过 1000 字符，HOJ 在线调试不支持（请用本地测试或直接提交）。',
          status: 'RE',
          timeMs: 0,
        });
        continue;
      }
      if (i > 0 && interval > 0) {
        let left = interval - (Date.now() - lastSubmit);
        while (left > 0) {
          onProgress?.(`样例 ${i + 1}/${samples.length}：等待限流冷却 ${Math.ceil(left / 1000)}s…`);
          const step = Math.min(500, left);
          await sleep(step);
          left -= step;
        }
      }
      onProgress?.(`样例 ${i + 1}/${samples.length}：提交云端在线调试…`);
      let key: string;
      try {
        key = await submitWithRetry(s.input, s.output);
        lastSubmit = Date.now();
      } catch (e: any) {
        const msg = e instanceof OjError ? e.message : String(e?.message ?? e);
        cases.push({ index: i + 1, input: s.input, expected: s.output, actual: '', stderr: `提交失败：${msg}`, status: 'RE', timeMs: 0 });
        lastSubmit = Date.now();
        continue;
      }

      onProgress?.(`样例 ${i + 1}/${samples.length}：云端评测中…`);
      let vo: any;
      const t0 = Date.now();
      while (Date.now() - t0 < 40000) {
        await sleep(500);
        try {
          vo = await this.auth.api.getTestJudgeResult(key);
        } catch (e: any) {
          vo = { status: 4, stderr: e?.message ?? String(e) };
          break;
        }
        if (vo && vo.status !== 5 && vo.status != null) break;
      }
      if (!vo || vo.status === 5 || vo.status == null) {
        cases.push({ index: i + 1, input: s.input, expected: s.output, actual: '', stderr: '云端评测超时。', status: 'RE', timeMs: 0 });
        continue;
      }
      const st = Number(vo.status);
      const map: Record<number, CaseStatus> = {
        0: 'AC',
        [-1]: 'WA',
        [-3]: 'WA',
        [-2]: 'CE',
        1: 'TLE',
        2: 'RE',
        3: 'RE',
        4: 'RE',
        8: 'WA',
      };
      let caseStatus: CaseStatus = map[st] || 'RE';
      // No expected output (custom input, or a blank sample) → a clean run is just "OK", not WA.
      const noExpected = (s.output || '').trim() === '';
      if ((isCustom || noExpected) && [0, -1, -3, 8].includes(st)) caseStatus = 'OK';
      cases.push({
        index: i + 1,
        input: s.input,
        expected: s.output,
        actual: vo.userOutput ?? '',
        stderr: vo.stderr || '',
        status: caseStatus,
        timeMs: Number(vo.time) || 0,
      });
    }
    const result: RunResult = {
      ok: cases.every((c) => c.status === 'AC' || c.status === 'OK'),
      language,
      cases,
      totalTimeMs: Date.now() - start,
      cloud: true,
    };
    this.recordTest(ctx, isCustom ? '云端自定义' : '云端样例', result);
    return result;
  }

  async submit(ctx: ProblemContext, onProgress: (text: string) => void): Promise<any> {
    if (!(await this.auth.ensureLoggedIn())) return { error: '未登录' };
    const fileUri = await this.getSolutionUri(ctx);
    if (!fileUri) return { error: '未找到对应的代码文件。' };
    await this.saveDocument(fileUri); // persist unsaved edits before submitting
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const code = doc.getText();
    if (!code.trim()) return { error: '代码为空，无法提交。' };
    const defaultLang = vscode.workspace.getConfiguration('nuaaOj').get<string>('defaultLanguage', 'C++');
    const fileLang = extensionToLanguage(path.extname(fileUri.fsPath).toLowerCase());
    // Submission language follows the actual file; a language forbidden for this problem blocks submission.
    const language = submissionLanguage(ctx, fileUri.fsPath) || pickLanguage(ctx, fileLang, defaultLang);
    if (!language) return { error: '无法判断提交语言。' };
    if (ctx.allowedLanguages && ctx.allowedLanguages.length && !ctx.allowedLanguages.includes(language)) {
      return { error: `当前文件语言「${language}」在此题被禁止使用。本题仅允许：${ctx.allowedLanguages.join('、')}。` };
    }
    if (vscode.workspace.getConfiguration('nuaaOj').get<boolean>('submit.confirm', false)) {
      const ok = await vscode.window.showWarningMessage(`确认提交 ${ctx.displayId}（${language}）？`, { modal: true }, '提交');
      if (!ok) return undefined;
    }

    let judge;
    try {
      onProgress(`正在提交 ${ctx.displayId}（${language}）…`);
      judge = await this.auth.api.submit({
        pid: ctx.displayId,
        language,
        code,
        cid: 0,
        tid: ctx.tid,
        gid: ctx.gid,
        isRemote: false,
      });
    } catch (e: any) {
      const msg = e instanceof OjError ? e.message : String(e?.message ?? e);
      this.output.appendLine(`[submit] 失败：${msg}`);
      return { error: msg };
    }

    const submitId = judge.submitId;
    this.output.appendLine(`[submit] submitId=${submitId} status=${judge.status}`);
    onProgress(`已提交 #${submitId}，等待评测…`);
    this.onDataChanged();

    const interval = vscode.workspace.getConfiguration('nuaaOj').get<number>('pollIntervalMs', 1000);
    const timeout = vscode.workspace.getConfiguration('nuaaOj').get<number>('pollTimeoutMs', 120000);
    const start = Date.now();
    let last = judge;
    while (Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, Math.max(500, interval)));
      try {
        const det = await this.auth.api.getSubmissionDetail(submitId);
        last = det.submission;
      } catch (e: any) {
        this.output.appendLine(`[poll] 查询失败：${e?.message ?? e}`);
        continue;
      }
      const meta = statusMeta(last.status);
      onProgress(`评测中… 当前状态：${meta.name}（#${submitId}）`);
      if (meta.final) break;
    }

    const meta = statusMeta(last.status);
    this.output.appendLine(`[submit] 最终状态 ${meta.name} time=${last.time} mem=${last.memory} score=${last.score}`);

    let cases: any[] = [];
    try {
      const c = await this.auth.api.getAllCaseResult(submitId);
      const list = c?.judgeCaseList || c?.subTaskJudgeCaseList || [];
      cases = list.map((x: any) => ({
        seq: x.seq,
        statusText: statusMeta(x.status).short,
        time: x.time,
        memory: x.memory,
        score: x.score,
      }));
    } catch {
      /* case results optional */
    }

    this.onDataChanged();
    // For Accepted submissions the OJ returns a placeholder errorMessage ("does not support viewing");
    // don't show that as "评测信息".
    const errorMessage = meta.short === 'AC' ? undefined : last.errorMessage || undefined;
    return {
      submitId,
      status: meta,
      time: last.time,
      memory: last.memory,
      score: last.score,
      errorMessage,
      cases,
    };
  }

  openInBrowser(ctx: ProblemContext): void {
    vscode.env.openExternal(vscode.Uri.parse(ctx.url));
  }

  openExternal(url: string): void {
    vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /**
   * Fetch the user's most recent AC code for the problem and put it into the solution file.
   * If the AC code's language differs from the current file, first switch/create the file for
   * that language (same logic as changing language), then overwrite it — always after confirmation.
   */
  async loadLastAcceptedCode(ctx: ProblemContext): Promise<{
    ok: boolean;
    message?: string;
    noCode?: boolean;
    cancelled?: boolean;
    fileName?: string;
    language?: string;
    switched?: boolean;
  }> {
    if (!(await this.auth.ensureLoggedIn())) return { ok: false, message: '未登录' };
    let fileUri = await this.getSolutionUri(ctx);
    if (!fileUri) return { ok: false, message: '未找到对应的代码文件。' };
    let vo: { submitId?: number; code: string; language?: string };
    try {
      vo = await this.auth.api.getUserLastAcceptedCode(ctx.pid);
    } catch (e: any) {
      return { ok: false, message: `获取最近通过代码失败：${e?.message ?? e}` };
    }
    const code = vo?.code || '';
    if (!code.trim()) {
      return { ok: false, noCode: true, message: '还没有通过过这道题，暂无最近通过的代码。' };
    }
    if (code.length < 400 && /hidden|super administrator|已被隐藏|隐藏/.test(code)) {
      return { ok: false, message: '网站已开启“隐藏非比赛提交代码”，无法获取最近通过的代码。' };
    }

    const currentLang = extensionToLanguage(path.extname(fileUri.fsPath).toLowerCase());
    const targetLang = vo.language || currentLang || '';
    let switched = false;

    if (targetLang && currentLang && targetLang !== currentLang) {
      // Different language: switch/create the file for the AC code's language first.
      if (ctx.allowedLanguages && ctx.allowedLanguages.length && !ctx.allowedLanguages.includes(targetLang)) {
        return {
          ok: false,
          message: `最近通过的代码语言「${targetLang}」不在本题允许的语言内（本题允许：${ctx.allowedLanguages.join('、')}）。`,
        };
      }
      const targetName = `${ctx.displayId}${languageToExtension(targetLang)}`;
      const confirm = await vscode.window.showWarningMessage(
        `最近通过的代码是「${targetLang}」，与当前文件语言「${currentLang}」不同。\n将切换到「${targetName}」并用最近通过的代码覆盖它，确定吗？`,
        { modal: true },
        '切换并覆盖',
      );
      if (confirm !== '切换并覆盖') return { ok: false, cancelled: true };
      const sw = await this.changeLanguageAndCreateFile(ctx, targetLang);
      if (!sw.ok) return { ok: false, message: sw.message || '切换到最近通过语言失败。' };
      fileUri = (await this.getSolutionUri(ctx)) || fileUri;
      switched = true;
    } else {
      const fileName = path.basename(fileUri.fsPath);
      const confirm = await vscode.window.showWarningMessage(
        `将用最近通过的代码覆盖当前文件「${fileName}」${targetLang ? `（语言：${targetLang}）` : ''}。现有内容会被替换，确定吗？`,
        { modal: true },
        '覆盖',
      );
      if (confirm !== '覆盖') return { ok: false, cancelled: true };
    }

    await this.saveDocument(fileUri);
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), code);
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) await doc.save();
    } catch (e: any) {
      return { ok: false, message: `写入文件失败：${e?.message ?? e}` };
    }
    const fileName = path.basename(fileUri.fsPath);
    const idLabel = vo.submitId ? `（#${vo.submitId}）` : '';
    return {
      ok: true,
      message: switched
        ? `已切换到 ${targetLang} 并载入最近通过的代码${idLabel}，已写入「${fileName}」。`
        : `已载入最近通过的代码${idLabel}，已覆盖「${fileName}」。`,
      fileName,
      language: targetLang,
      switched,
    };
  }

  copySample(text: string): void {
    vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage('已复制样例输入到剪贴板', 2000);
  }

  async reload(panel: ProblemPanel): Promise<void> {
    const ctx = panel.ctx;
    try {
      const target: ParsedTarget = { kind: ctx.kind, displayId: ctx.displayId, tid: ctx.tid };
      const detail = await this.fetchDetail(target);
      const fresh = buildContext(ctx.kind, detail, this.base(), ctx.tid);
      panel.detail = detail;
      panel.ctx.samples = fresh.samples;
      panel.ctx.title = fresh.title;
      panel.ctx.timeLimit = fresh.timeLimit;
      panel.ctx.memoryLimit = fresh.memoryLimit;
      panel.ctx.isFileIO = fresh.isFileIO;
      panel.ctx.ioReadFileName = fresh.ioReadFileName;
      panel.ctx.ioWriteFileName = fresh.ioWriteFileName;
      const folder = problemFolderUri(panel.ctx);
      if (folder) await saveContext(folder, panel.ctx);
      await panel.render();
    } catch (e: any) {
      panel.postError(`刷新失败：${e?.message ?? e}`);
    }
  }

  // ---- Context discovery from active editor --------------------------------
  async contextFromActiveEditor(): Promise<ProblemContext | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') return undefined;
    return loadContextForFile(editor.document.uri);
  }

  private reportError(prefix: string, e: any) {
    const msg = e instanceof OjError ? e.message : String(e?.message ?? e);
    this.output.appendLine(`[error] ${prefix}：${msg}`);
    vscode.window.showErrorMessage(`${prefix}：${msg}`);
  }
}

