import * as vscode from 'vscode';
import * as path from 'path';
import { ProblemDetail } from './types';
import { ProblemContext, languageToExtension } from './context';
import { RunResult } from './runner';
import { InitialState, renderProblemHtml } from './statement';

export interface ProblemPanelHost {
  runTest(ctx: ProblemContext): Promise<RunResult>;
  submit(ctx: ProblemContext, onProgress: (text: string) => void): Promise<any>;
  changeLanguage(ctx: ProblemContext, language: string): Promise<{ ok: boolean; fileName?: string; language?: string; message?: string }>;
  loadLastAcceptedCode(ctx: ProblemContext): Promise<{ ok: boolean; message?: string; noCode?: boolean; cancelled?: boolean; fileName?: string; language?: string; switched?: boolean }>;
  openInBrowser(ctx: ProblemContext): void;
  copySample(text: string): void;
  reload(panel: ProblemPanel): Promise<void>;
  getInitialState(ctx: ProblemContext): Promise<InitialState>;
}

export class ProblemPanel {
  public static current: Map<string, ProblemPanel> = new Map();

  private disposables: vscode.Disposable[] = [];
  private overrideInit: Partial<InitialState> = {};

  /** Close every open problem statement panel (used when focus moves to a non-problem file). */
  static closeAll(): void {
    const panels = [...ProblemPanel.current.values()];
    for (const p of panels) {
      try {
        p.panel.dispose();
      } catch {
        /* ignore */
      }
    }
    ProblemPanel.current.clear();
  }

  static key(ctx: ProblemContext): string {
    return `${ctx.kind}:${ctx.tid ?? 0}:${ctx.displayId}`;
  }

  constructor(
    public readonly panel: vscode.WebviewPanel,
    public detail: ProblemDetail,
    public ctx: ProblemContext,
    private host: ProblemPanelHost,
    private extensionUri: vscode.Uri,
  ) {
    ProblemPanel.current.set(ProblemPanel.key(ctx), this);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m), null, this.disposables);
  }

  static async show(
    ctx: ProblemContext,
    detail: ProblemDetail,
    host: ProblemPanelHost,
    extensionUri: vscode.Uri,
    reveal = true,
  ): Promise<ProblemPanel> {
    const key = ProblemPanel.key(ctx);
    const existing = ProblemPanel.current.get(key);
    if (existing) {
      existing.detail = detail;
      existing.ctx = ctx;
      await existing.render();
      if (reveal) existing.panel.reveal(vscode.ViewColumn.Beside, true);
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(
      'nuaaOjProblem',
      `题目 ${ctx.displayId}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [extensionUri] },
    );
    const p = new ProblemPanel(panel, detail, ctx, host, extensionUri);
    await p.render();
    return p;
  }

  async render(): Promise<void> {
    const base = await this.host.getInitialState(this.ctx);
    const init = { ...base, ...this.overrideInit };
    this.panel.title = `${this.ctx.displayId} · ${this.ctx.title}`;
    this.panel.webview.html = renderProblemHtml(this.panel.webview, this.detail, this.ctx, init, this.extensionUri);
  }

  /**
   * Update the panel to reflect the active file: its language becomes the panel's language,
   * and if that language is forbidden for the problem, the submit button is disabled.
   */
  async setActiveFile(ctx: ProblemContext, fileUri: vscode.Uri, language: string, allowed: boolean): Promise<void> {
    this.ctx = ctx;
    this.ctx.solutionFile = path.basename(fileUri.fsPath);
    if (allowed) {
      const ext = path.extname(fileUri.fsPath).toLowerCase();
      const sel = this.ctx.selectedLanguage;
      if (!sel || languageToExtension(sel) !== ext) {
        this.ctx.selectedLanguage = language;
      }
      this.overrideInit = {};
    } else {
      this.overrideInit = { canSubmit: false, forbiddenLanguage: language };
    }
    await this.render();
    if (!allowed) {
      this.postError(
        `当前文件语言「${language}」在本题中被禁止使用。本题仅允许：${(ctx.allowedLanguages || []).join('、')}。请切换语言或改用允许的扩展名。`,
      );
    }
  }

  postStatus(text: string) {
    this.panel.webview.postMessage({ type: 'status', text });
  }
  postError(text: string) {
    this.panel.webview.postMessage({ type: 'error', text });
  }
  postTestResult(result: RunResult) {
    this.panel.webview.postMessage({ type: 'testResult', result });
  }
  postSubmitResult(result: any) {
    this.panel.webview.postMessage({ type: 'submitResult', result });
  }

  private async onMessage(m: any) {
    try {
      switch (m?.type) {
        case 'ready': {
          const init = await this.host.getInitialState(this.ctx);
          this.panel.webview.postMessage({ type: 'meta', language: init.language });
          break;
        }
        case 'test': {
          this.postStatus('正在编译并运行样例…');
          const res = await this.host.runTest(this.ctx);
          this.postTestResult(res);
          break;
        }
        case 'submit': {
          const final = await this.host.submit(this.ctx, (t) => this.postStatus(t));
          if (final) this.postSubmitResult(final);
          break;
        }
        case 'loadAc': {
          const r = await this.host.loadLastAcceptedCode(this.ctx);
          if (r.ok) {
            if (r.fileName && r.language) {
              this.panel.webview.postMessage({ type: 'languageChanged', language: r.language, fileName: r.fileName });
            }
            this.postStatus(r.message || '已载入最近通过的代码。');
          } else if (r.noCode) this.postStatus(r.message || '还没有通过过这道题，暂无最近通过的代码。');
          else if (!r.cancelled) this.postError(r.message || '无法获取最近通过的代码。');
          break;
        }
        case 'changeLanguage': {
          const res = await this.host.changeLanguage(this.ctx, String(m.language));
          if (res.ok) {
            this.overrideInit = {};
            await this.render();
            this.panel.webview.postMessage({ type: 'languageChanged', language: res.language, fileName: res.fileName });
          } else {
            this.postError(res.message || '切换语言失败');
          }
          break;
        }
        case 'openInBrowser':
          this.host.openInBrowser(this.ctx);
          break;
        case 'refresh':
          await this.host.reload(this);
          break;
        case 'copySample': {
          const idx = Number(m.index);
          const sample = this.ctx.samples[idx];
          if (sample) this.host.copySample(sample.input);
          break;
        }
      }
    } catch (e: any) {
      this.postError(String(e?.message ?? e));
    }
  }

  dispose() {
    ProblemPanel.current.delete(ProblemPanel.key(this.ctx));
    while (this.disposables.length) {
      const d = this.disposables.pop();
      try {
        d?.dispose();
      } catch {
        /* ignore */
      }
    }
  }
}
