import * as vscode from 'vscode';
import { OjApi, OjError } from './api';
import { UserInfo } from './types';

const TOKEN_KEY = 'nuaaOj.token';
const CRED_KEY = 'nuaaOj.credentials';

interface StoredToken {
  token: string;
  exp?: number; // epoch seconds
}

function decodeJwtExp(token: string): number | undefined {
  try {
    const part = token.split('.')[1];
    if (!part) return undefined;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

export class AuthManager {
  private token: string | undefined;
  private exp: number | undefined;
  private user: UserInfo | undefined;
  private currentBaseUrl: string;
  public api: OjApi;

  constructor(private context: vscode.ExtensionContext) {
    this.currentBaseUrl = this.getBaseUrl();
    this.api = new OjApi({
      baseUrl: this.currentBaseUrl,
      getToken: () => this.token,
      onUnauthorized: () => this.silentRelogin(),
    });
  }

  private getBaseUrl(): string {
    return vscode.workspace.getConfiguration('nuaaOj').get<string>('baseUrl', 'https://oj.nuaa.edu.cn').trim() || 'https://oj.nuaa.edu.cn';
  }

  /** Re-read baseUrl from settings; rebuild client if changed. */
  syncBaseUrl() {
    const url = this.getBaseUrl();
    if (url !== this.currentBaseUrl) {
      this.currentBaseUrl = url;
      this.api.setBaseUrl(url);
    }
  }

  get currentUser(): UserInfo | undefined {
    return this.user;
  }

  get displayName(): string {
    return this.user ? this.user.nickname || this.user.username : '';
  }

  async restore(): Promise<void> {
    const stored = await this.context.secrets.get(TOKEN_KEY);
    if (stored) {
      try {
        const parsed: StoredToken = JSON.parse(stored);
        if (parsed.token && (!parsed.exp || parsed.exp * 1000 > Date.now() + 5000)) {
          this.token = parsed.token;
          this.exp = parsed.exp;
        }
      } catch {
        /* ignore */
      }
    }
    // Try to load cached user info.
    const cachedUser = this.context.globalState.get<UserInfo>('nuaaOj.user');
    if (cachedUser) this.user = cachedUser;
  }

  async hasUsableToken(): Promise<boolean> {
    if (!this.token) return false;
    if (this.exp && this.exp * 1000 <= Date.now() + 5000) return false;
    return true;
  }

  async login(username: string, password: string): Promise<UserInfo> {
    this.syncBaseUrl();
    const { token, user } = await this.api.login(username, password);
    this.token = token;
    this.exp = decodeJwtExp(token);
    this.user = user;
    await this.context.secrets.store(TOKEN_KEY, JSON.stringify({ token, exp: this.exp } satisfies StoredToken));
    await this.context.secrets.store(CRED_KEY, JSON.stringify({ username, password }));
    await this.context.globalState.update('nuaaOj.user', user);
    return user;
  }

  /** Attempt to log in again using saved credentials. Returns the fresh token or undefined. */
  async silentRelogin(): Promise<string | undefined> {
    const credRaw = await this.context.secrets.get(CRED_KEY);
    if (!credRaw) return undefined;
    try {
      const { username, password } = JSON.parse(credRaw);
      if (!username || !password) return undefined;
      const { token, user } = await this.api.login(username, password);
      this.token = token;
      this.exp = decodeJwtExp(token);
      this.user = user;
      await this.context.secrets.store(TOKEN_KEY, JSON.stringify({ token, exp: this.exp } satisfies StoredToken));
      await this.context.globalState.update('nuaaOj.user', user);
      return token;
    } catch {
      return undefined;
    }
  }

  /** Ensure we have a usable token; otherwise try silent login; otherwise ask the user. */
  async ensureLoggedIn(interactive = true): Promise<boolean> {
    this.syncBaseUrl();
    if (await this.hasUsableToken()) return true;
    const fresh = await this.silentRelogin();
    if (fresh) return true;
    if (!interactive) return false;
    return this.promptLogin();
  }

  async promptLogin(): Promise<boolean> {
    this.syncBaseUrl();
    const cfgUser = vscode.workspace.getConfiguration('nuaaOj').get<string>('username', '') || '';
    const username = await vscode.window.showInputBox({
      title: '登录 NUAA OJ',
      prompt: `服务器：${this.currentBaseUrl}`,
      value: cfgUser,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : '请输入用户名 / 学号'),
    });
    if (!username) return false;
    const password = await vscode.window.showInputBox({
      title: '登录 NUAA OJ',
      prompt: `用户 ${username} 的密码（保存在系统密钥库）`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v ? undefined : '请输入密码'),
    });
    if (password === undefined) return false;
    try {
      const user = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在登录 NUAA OJ…' },
        () => this.login(username, password),
      );
      await vscode.workspace.getConfiguration('nuaaOj').update('username', username, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`NUAA OJ 登录成功：${user.nickname || user.username}（${user.username}）`);
      return true;
    } catch (e: any) {
      const msg = e instanceof OjError ? e.message : String(e?.message ?? e);
      vscode.window.showErrorMessage(`登录失败：${msg}`);
      return false;
    }
  }

  async logout(): Promise<void> {
    this.token = undefined;
    this.exp = undefined;
    this.user = undefined;
    await this.context.secrets.delete(TOKEN_KEY);
    await this.context.secrets.delete(CRED_KEY);
    await this.context.globalState.update('nuaaOj.user', undefined);
  }
}
