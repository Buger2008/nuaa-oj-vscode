import * as vscode from 'vscode';
import * as path from 'path';
import { AuthManager } from './auth';
import { OjError } from './api';
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
import { RunResult, RunnerConfig, isLocallyRunnable, runSamples } from './runner';
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

  private base(): string {
    return vscode.workspace.getConfiguration('nuaaOj').get<string>('baseUrl', 'https://oj.nuaa.edu.cn').replace(/\/+$/, '');
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
      cArgs: c.get<string>('compiler.cArgs', '-O2 -std=c11 -lm'),
      cpp: cppComp.command,
      cppArgs: c.get<string>('compiler.cppArgs', '-O2 -std=c++17'),
      java: c.get<string>('compiler.java', 'javac'),
      javaRun: c.get<string>('compiler.javaRun', 'java'),
      python: c.get<string>('compiler.python', process.platform === 'win32' ? 'python' : 'python3'),
      javascript: c.get<string>('compiler.javascript', 'node'),
      go: c.get<string>('compiler.go', 'go'),
      rust: c.get<string>('compiler.rust', 'rustc'),
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
    const language = extensionToLanguage(path.extname(fileUri.fsPath).toLowerCase()) || ctx.language || '';
    if (ctx.isFileIO) {
      return {
        ok: false,
        language,
        cases: [],
        totalTimeMs: 0,
        skipped: '该题为文件 IO 题，本地无法获取官方测试文件，请直接使用“提交代码”进行云端评测。',
      };
    }
    if (!ctx.samples.length) {
      return { ok: false, language, cases: [], totalTimeMs: 0, skipped: '该题没有公开样例，无法本地测试。可自行在代码中调试后提交。' };
    }
    if (!isLocallyRunnable(language, fileUri.fsPath)) {
      return { ok: false, language, cases: [], totalTimeMs: 0, skipped: `当前语言 ${language} 暂不支持本地运行，请直接提交评测。` };
    }
    return runSamples(fileUri.fsPath, language, ctx.samples, ctx.timeLimit, await this.runnerConfig(), (m) => this.output.appendLine(`[test] ${m}`));
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

  /**
   * Fetch the user's most recent AC code for the problem and overwrite the current solution file
   * (after confirmation). If the user has never AC'd it, return noCode so the UI can show a hint.
   */
  async loadLastAcceptedCode(
    ctx: ProblemContext,
  ): Promise<{ ok: boolean; message?: string; noCode?: boolean; cancelled?: boolean }> {
    if (!(await this.auth.ensureLoggedIn())) return { ok: false, message: '未登录' };
    const fileUri = await this.getSolutionUri(ctx);
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
    await this.saveDocument(fileUri);
    const fileName = path.basename(fileUri.fsPath);
    const lang = vo.language || '';
    const confirm = await vscode.window.showWarningMessage(
      `将用最近通过的代码覆盖当前文件「${fileName}」${lang ? `（语言：${lang}）` : ''}。现有内容会被替换，确定吗？`,
      { modal: true },
      '覆盖',
    );
    if (confirm !== '覆盖') return { ok: false, cancelled: true };
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), code);
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) await doc.save();
    } catch (e: any) {
      return { ok: false, message: `写入文件失败：${e?.message ?? e}` };
    }
    return {
      ok: true,
      message: `已载入最近通过的代码${vo.submitId ? `（#${vo.submitId}）` : ''}，已覆盖「${fileName}」。`,
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
