import * as vscode from 'vscode';
import * as path from 'path';
import { AuthManager } from './auth';
import { NuaaOjService } from './service';
import { ProblemPanel } from './problemPanel';
import { CurrentProblemProvider } from './tree';
import { HomeViewProvider } from './homeView';
import { ProblemContext, cleanupTempRoot, extensionToLanguage, isLanguageLocked, pickLanguage } from './context';
import { ProblemDetail } from './types';
import { LoginPanel } from './loginPanel';

let output: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('NUAA OJ');
  context.subscriptions.push(output);

  const auth = new AuthManager(context);
  await auth.restore();

  const currentProvider = new CurrentProblemProvider();
  const baseUrl = () => vscode.workspace.getConfiguration('nuaaOj').get<string>('baseUrl', 'https://oj.nuaa.edu.cn').replace(/\/+$/, '');

  const setCurrent = (ctx: ProblemContext | undefined) => {
    currentProvider.setContext(ctx);
    void vscode.commands.executeCommand('setContext', 'nuaaOj.hasProblem', !!ctx);
  };

  const updateStatusBar = () => {
    if (auth.currentUser) {
      statusBar.text = `$(account) ${auth.currentUser.nickname || auth.currentUser.username}`;
      statusBar.tooltip = `NUAA OJ 已登录：${auth.currentUser.username}（点击切换账号）`;
      void vscode.commands.executeCommand('setContext', 'nuaaOj.loggedIn', true);
    } else {
      statusBar.text = '$(account) NUAA OJ 登录';
      statusBar.tooltip = '点击登录 NUAA OJ';
      void vscode.commands.executeCommand('setContext', 'nuaaOj.loggedIn', false);
    }
    statusBar.show();
  };

  let homeProvider: HomeViewProvider;
  const refreshAll = () => {
    updateStatusBar();
    homeProvider?.refresh();
  };

  const service = new NuaaOjService(auth, output, context, context.extensionUri, refreshAll);

  const refreshAfterAuth = () => {
    updateStatusBar();
    homeProvider?.refresh();
    currentProvider.refresh();
  };

  homeProvider = new HomeViewProvider(auth, context.extensionUri, {
    openProblem: async (value: string) => {
      const v = String(value).includes('training/') ? `${baseUrl()}/${value}` : String(value);
      const ctx = await service.openProblem(v);
      if (ctx) {
        setCurrent(ctx);
        if (isLanguageLocked(ctx)) {
          vscode.window.showInformationMessage(`该题仅允许使用 ${ctx.allowedLanguages?.[0]}，已自动锁定。`);
        }
      }
    },
    openLogin: () => LoginPanel.show(auth, baseUrl(), refreshAfterAuth),
    logout: async () => {
      await auth.logout();
      updateStatusBar();
      homeProvider.refresh();
    },
    openUrl: (url: string) => void vscode.env.openExternal(vscode.Uri.parse(url)),
    openProfile: () => void service.openProfile(),
    openSettings: () => void service.openSettings(),
    onChange: refreshAll,
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HomeViewProvider.viewType, homeProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'nuaaOj.login';
  context.subscriptions.push(statusBar);
  updateStatusBar();

  const ensurePanel = async (ctx: ProblemContext): Promise<ProblemPanel> => {
    const detail = await service.fetchDetailFor(ctx);
    return ProblemPanel.show(ctx, detail, service, context.extensionUri, false);
  };

  const revealPanel = (panel: ProblemPanel): void => {
    try {
      if (!panel.isDisposed) panel.panel.reveal(vscode.ViewColumn.Beside, true);
    } catch {
      /* panel disposed */
    }
  };

  const requireContext = async (): Promise<ProblemContext | undefined> => {
    const ctx = await service.contextFromActiveEditor();
    if (ctx) {
      setCurrent(ctx);
      return ctx;
    }
    const input = await vscode.window.showInputBox({
      title: '关联题目',
      prompt: '当前文件不属于任何 NUAA OJ 题目目录。输入要关联的题目编号或链接以打开题目。',
      placeHolder: 'E1 或 https://oj.nuaa.edu.cn/problem/E1',
    });
    if (!input) return undefined;
    const opened = await service.openProblem(input);
    if (opened) setCurrent(opened);
    return opened;
  };

  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // ---- Login / logout -------------------------------------------------------
  reg('nuaaOj.login', () => {
    LoginPanel.show(auth, baseUrl(), refreshAfterAuth);
  });

  reg('nuaaOj.logout', async () => {
    await auth.logout();
    updateStatusBar();
    homeProvider.refresh();
    currentProvider.refresh();
    vscode.window.showInformationMessage('已退出 NUAA OJ。');
  });

  // ---- Opening problems -----------------------------------------------------
  reg('nuaaOj.openProblem', async (arg?: string) => {
    let input = typeof arg === 'string' ? arg : undefined;
    if (!input) {
      input = await vscode.window.showInputBox({
        title: '打开题目',
        prompt: '输入题目编号（如 E1、9999、CPP2-4）或题目 / 训练题链接',
        placeHolder: 'E1 或 https://oj.nuaa.edu.cn/training/8/problem/9999',
        ignoreFocusOut: true,
      });
    }
    if (!input) return;
    const ctx = await service.openProblem(input.trim());
    if (ctx) {
      setCurrent(ctx);
      if (isLanguageLocked(ctx)) {
        vscode.window.showInformationMessage(`该题仅允许使用 ${ctx.allowedLanguages?.[0]}，已自动锁定。`);
      }
    }
  });

  reg('nuaaOj.openFromClipboard', async () => {
    const text = (await vscode.env.clipboard.readText()).trim();
    if (!text) {
      vscode.window.showWarningMessage('剪贴板为空。');
      return;
    }
    const ctx = await service.openProblem(text);
    if (ctx) setCurrent(ctx);
  });

  // ---- Search / browse ------------------------------------------------------
  reg('nuaaOj.refreshProblems', async () => {
    homeProvider.refresh();
  });
  reg('nuaaOj.refreshSubmissions', async () => {
    homeProvider.refresh();
  });
  reg('nuaaOj.refreshTraining', async () => {
    homeProvider.refresh();
  });
  reg('nuaaOj.refreshHomework', async () => {
    homeProvider.refresh();
  });

  reg('nuaaOj.openTraining', async () => {
    if (!(await auth.ensureLoggedIn())) return;
    try {
      const page = await auth.api.getTrainingList({ currentPage: 1, limit: 200 });
      const items = (page.records || []).map((t: any) => ({
        label: t.title,
        description: `${t.problemCount ?? ''} 题${t.categoryName ? ' · ' + t.categoryName : ''}`,
        detail: `#${t.id}`,
        tid: t.id,
        title: t.title,
      }));
      if (!items.length) {
        vscode.window.showInformationMessage('没有可访问的训练题单。');
        return;
      }
      const pick = await vscode.window.showQuickPick(items, { title: '选择训练题单', placeHolder: '输入关键词筛选训练题单', matchOnDescription: true });
      if (!pick) return;
      const probs = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `正在加载「${pick.title}」的题目…` },
        () => auth.api.getTrainingProblemList(Number(pick.tid)),
      );
      const pitems = (probs || []).map((p: any) => ({ label: `${p.problemId}  ${p.title}`, description: p.difficulty ? `难度 ${p.difficulty}` : '', displayId: p.problemId }));
      if (!pitems.length) {
        vscode.window.showInformationMessage('该训练题单暂时没有题目。');
        return;
      }
      const pp = await vscode.window.showQuickPick(pitems, { title: `训练：${pick.title}`, placeHolder: '选择要打开的题目' });
      if (!pp) return;
      const ctx = await service.openProblem(`${baseUrl()}/training/${pick.tid}/problem/${pp.displayId}`);
      if (ctx) setCurrent(ctx);
    } catch (e: any) {
      vscode.window.showErrorMessage(`加载训练题单失败：${e?.message ?? e}`);
    }
  });

  // ---- Language selection ---------------------------------------------------
  reg('nuaaOj.selectLanguage', async () => {
    let ctx = currentProvider.current;
    if (!ctx) ctx = await service.contextFromActiveEditor();
    if (!ctx) {
      vscode.window.showInformationMessage('请先打开一个题目。');
      return;
    }
    if (isLanguageLocked(ctx)) {
      vscode.window.showInformationMessage(`该题仅允许使用 ${ctx.allowedLanguages?.[0]}，已锁定。`);
      return;
    }
    let allowed: string[];
    if (ctx.allowedLanguages && ctx.allowedLanguages.length) allowed = ctx.allowedLanguages;
    else {
      try {
        allowed = (await auth.api.getLanguages()).map((l) => l.name);
      } catch (e: any) {
        vscode.window.showErrorMessage(`获取语言列表失败：${e?.message ?? e}`);
        return;
      }
    }
    const defaultLang = vscode.workspace.getConfiguration('nuaaOj').get<string>('defaultLanguage', 'C++');
    const fileLang = ctx.solutionFile ? extensionToLanguage(path.extname(ctx.solutionFile).toLowerCase()) : undefined;
    const current = pickLanguage(ctx, fileLang, defaultLang);
    const pick = await vscode.window.showQuickPick(
      allowed.map((name) => ({ label: name, description: name === current ? '当前' : '', picked: name === current })),
      { title: `选择语言（${ctx.displayId}）`, placeHolder: '该题允许使用的语言', matchOnDescription: true },
    );
    if (!pick) return;
    const res = await service.changeLanguageAndCreateFile(ctx, pick.label);
    if (!res.ok) {
      vscode.window.showWarningMessage(res.message || '无法切换语言。');
      return;
    }
    setCurrent(ctx);
    vscode.window.showInformationMessage(`已切换语言为 ${pick.label}，新建文件 ${res.fileName}（提交将使用该文件）。`);
  });

  // ---- Test / submit --------------------------------------------------------
  const runCurrent = async (action: 'test' | 'submit') => {
    const ctx = await requireContext();
    if (!ctx) return;
    if (!(await auth.ensureLoggedIn())) return;
    const panel = await ensurePanel(ctx);
    revealPanel(panel);
    if (action === 'test') {
      panel.postStatus('正在运行样例…');
      const res = await service.runTest(ctx);
      panel.postTestResult(res);
    } else {
      const final = await service.submit(ctx, (t) => panel.postStatus(t));
      if (final) panel.postSubmitResult(final);
    }
  };

  reg('nuaaOj.testCurrent', () => runCurrent('test'));
  reg('nuaaOj.submitCurrent', () => runCurrent('submit'));

  reg('nuaaOj.showProblem', async () => {
    let ctx = currentProvider.current;
    if (!ctx) ctx = await service.contextFromActiveEditor();
    if (!ctx) {
      vscode.window.showInformationMessage('请先打开一个 NUAA OJ 题目。');
      return;
    }
    setCurrent(ctx);
    const panel = await ensurePanel(ctx);
    revealPanel(panel);
  });

  reg('nuaaOj.openInBrowser', async () => {
    const ctx = currentProvider.current || (await service.contextFromActiveEditor());
    if (!ctx) return;
    service.openInBrowser(ctx);
  });

  reg('nuaaOj.openAssistant', async () => {
    let ctx = currentProvider.current;
    if (!ctx) ctx = await service.contextFromActiveEditor();
    if (!ctx) {
      vscode.window.showInformationMessage('请先打开一个题目。');
      return;
    }
    await service.openAssistant(ctx);
  });

  reg('nuaaOj.loadLastAcceptedCode', async () => {    const ctx = currentProvider.current || (await service.contextFromActiveEditor());
    if (!ctx) {
      vscode.window.showInformationMessage('请先打开一个题目。');
      return;
    }
    const res = await service.loadLastAcceptedCode(ctx);
    if (res.ok) {
      currentProvider.setContext(ctx);
      vscode.window.showInformationMessage(res.message || '已载入最近通过的代码。');
    } else if (res.noCode) vscode.window.showInformationMessage(res.message || '还没有通过过这道题。');
    else if (!res.cancelled) vscode.window.showWarningMessage(res.message || '无法获取最近通过的代码。');
  });

  // Cache problem details so switching between files of the same problem doesn't refetch.
  const detailCache = new Map<string, ProblemDetail>();
  const getDetailFor = async (ctx: ProblemContext): Promise<ProblemDetail> => {
    const key = ProblemPanel.key(ctx);
    const cached = detailCache.get(key);
    if (cached) return cached;
    const d = await service.fetchDetailFor(ctx);
    detailCache.set(key, d);
    return d;
  };

  // React to the user opening / switching / closing / deleting files.
  let lastSignature: string | undefined;

  const clearAndClose = () => {
    void vscode.commands.executeCommand('setContext', 'nuaaOj.hasProblem', false);
    void vscode.commands.executeCommand('setContext', 'nuaaOj.canSubmit', false);
    currentProvider.setContext(undefined);
    lastSignature = undefined;
    ProblemPanel.closeAll();
  };

  const applyInfo = async (info: { ctx: ProblemContext; fileUri: vscode.Uri; language: string; allowed: boolean }) => {
    const signature = `${ProblemPanel.key(info.ctx)}|${info.ctx.solutionFile}|${info.language}|${info.allowed}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    void vscode.commands.executeCommand('setContext', 'nuaaOj.hasProblem', true);
    void vscode.commands.executeCommand('setContext', 'nuaaOj.canSubmit', info.allowed);
    currentProvider.setContext(info.ctx);
    let panel = ProblemPanel.current.get(ProblemPanel.key(info.ctx));
    if (!panel) {
      const detail = await getDetailFor(info.ctx);
      panel = await ProblemPanel.show(info.ctx, detail, service, context.extensionUri, false);
      revealPanel(panel);
    }
    await panel.setActiveFile(info.ctx, info.fileUri, info.language, info.allowed);
  };

  const onActiveEditor = async () => {
    try {
      const ed = vscode.window.activeTextEditor;
      if (!ed || ed.document.uri.scheme !== 'file') {
        if (vscode.window.visibleTextEditors.length === 0) clearAndClose();
        return;
      }
      const info = await service.resolveActiveContext(ed.document.uri);
      if (!info) {
        clearAndClose();
        return;
      }
      await applyInfo(info);
    } catch (e: any) {
      output.appendLine(`[active] ${e?.message ?? e}`);
    }
  };

  const onAfterCloseOrDelete = async () => {
    try {
      const vis = vscode.window.visibleTextEditors;
      const ed = vscode.window.activeTextEditor || vis[vis.length - 1];
      const uri = ed?.document.uri;
      if (!uri || uri.scheme !== 'file') {
        clearAndClose();
        return;
      }
      const info = await service.resolveActiveContext(uri);
      if (!info) {
        clearAndClose();
        return;
      }
      await applyInfo(info);
    } catch (e: any) {
      output.appendLine(`[close] ${e?.message ?? e}`);
    }
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => void onActiveEditor()),
    vscode.window.onDidChangeVisibleTextEditors(() => void onActiveEditor()),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === 'file') void onAfterCloseOrDelete();
    }),
    vscode.workspace.onDidDeleteFiles(() => void onAfterCloseOrDelete()),
    vscode.workspace.onDidRenameFiles(() => void onAfterCloseOrDelete()),
  );
  void onActiveEditor();

  output.appendLine('NUAA OJ 扩展已启动。');

  context.subscriptions.push({ dispose: () => void cleanupTempRoot() });
}

export function deactivate(): void {
  void cleanupTempRoot();
}
