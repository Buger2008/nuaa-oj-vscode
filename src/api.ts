import {
  Judge,
  JudgeCaseResult,
  Language,
  Paged,
  ProblemDetail,
  SubmissionDetail,
  SubmissionRecord,
  TrainingInfo,
  UserInfo,
} from './types';

export class OjError extends Error {
  constructor(
    message: string,
    public httpStatus?: number,
    public bizStatus?: number,
  ) {
    super(message);
    this.name = 'OjError';
  }
}

export interface OjApiOptions {
  baseUrl: string;
  getToken?: () => string | undefined | Promise<string | undefined>;
  onUnauthorized?: () => Promise<string | undefined>;
  timeoutMs?: number;
}

interface RequestOptions {
  method?: string;
  query?: Record<string, any>;
  body?: any;
  auth?: boolean;
  timeoutMs?: number;
  raw?: boolean;
}

/**
 * Pure HTTP client for the HOJ (NUAA OJ) API. Contains no `vscode` imports so it
 * can be smoke-tested in plain Node.
 */
export class OjApi {
  private baseUrl: string;
  private getToken?: () => string | undefined | Promise<string | undefined>;
  private onUnauthorized?: () => Promise<string | undefined>;
  private timeoutMs: number;

  constructor(opts: OjApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.getToken = opts.getToken;
    this.onUnauthorized = opts.onUnauthorized;
    this.timeoutMs = opts.timeoutMs ?? 30000;
  }

  setBaseUrl(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private buildUrl(path: string, query?: Record<string, any>): string {
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : '/' + path));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v)) {
          v.forEach((item) => url.searchParams.append(k, String(item)));
        } else {
          url.searchParams.append(k, String(v));
        }
      }
    }
    return url.toString();
  }

  /** Low-level request returning the `data` field of the HOJ envelope. */
  async request<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
    const { method = 'GET', query, body, auth = true } = opts;
    const url = this.buildUrl(path, query);
    const doFetch = async (token?: string): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.timeoutMs);
      const headers: Record<string, string> = {
        'Url-Type': 'general',
        Accept: 'application/json, text/plain, */*',
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth && token) headers['Authorization'] = token;
      try {
        return await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let token: string | undefined;
    if (auth && this.getToken) {
      token = await this.getToken();
    }

    let res: Response;
    try {
      res = await doFetch(token);
      if (res.status === 401 && auth && this.onUnauthorized) {
        const fresh = await this.onUnauthorized();
        if (fresh) {
          res = await doFetch(fresh);
        }
      }
    } catch (e: any) {
      if (e && e.name === 'AbortError') {
        throw new OjError('请求超时，请检查网络或稍后重试。');
      }
      throw new OjError(`网络请求失败：${e?.message ?? e}`);
    }

    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      if (!res.ok) {
        throw new OjError(`服务器返回非 JSON 响应（HTTP ${res.status}）。`, res.status);
      }
      // Some endpoints may return plain text; return as-is when allowed.
      return text as unknown as T;
    }

    if (!res.ok) {
      const msg = json?.msg || json?.message || `HTTP ${res.status}`;
      throw new OjError(msg, res.status, json?.status);
    }
    if (json && typeof json.status === 'number' && json.status !== 200) {
      throw new OjError(json.msg || `业务错误（status=${json.status}）`, res.status, json.status);
    }
    return (json?.data ?? json) as T;
  }

  // ---- Authentication -------------------------------------------------------
  async login(username: string, password: string): Promise<{ token: string; user: UserInfo }> {
    const url = this.buildUrl('/api/login');
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Url-Type': 'general', Accept: 'application/json' },
        body: JSON.stringify({ username, password }),
      });
    } catch (e: any) {
      throw new OjError(`无法连接服务器：${e?.message ?? e}`);
    }
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* ignore */
    }
    if (!res.ok || (json.status && json.status !== 200)) {
      throw new OjError(json?.msg || `登录失败（HTTP ${res.status}）`, res.status, json?.status);
    }
    const token = res.headers.get('authorization') || res.headers.get('Authorization') || '';
    if (!token) {
      throw new OjError('登录成功但服务器未返回 Authorization 令牌。');
    }
    return { token, user: json.data as UserInfo };
  }

  async getUserAuthInfo(): Promise<{ roles: string[] } & UserInfo> {
    return this.request('/api/get-user-auth-info');
  }

  // ---- Problems -------------------------------------------------------------
  async getProblemDetail(problemId: string, gid?: number): Promise<ProblemDetail> {
    return this.request('/api/get-problem-detail', { query: { problemId, gid } });
  }

  async getTrainingProblemDetail(displayId: string, tid: number): Promise<ProblemDetail> {
    return this.request('/api/get-training-problem-details', { query: { displayId, tid } });
  }

  async getProblemList(params: {
    currentPage?: number;
    limit?: number;
    keyword?: string;
    difficulty?: number;
    oj?: string;
    tagId?: number[];
  } = {}): Promise<Paged<any>> {
    return this.request('/api/get-problem-list', { query: params });
  }

  /**
   * Per-problem status of the CURRENT user for a list of internal problem ids.
   * Returns { [pid]: { status, score } }; status 0 = AC, -10 = never submitted, else last verdict.
   */
  async getUserProblemStatus(
    pidList: number[],
    isContestProblemList = false,
    cid?: number,
    gid?: number,
    containsEnd = false,
  ): Promise<Record<string, any>> {
    return this.request('/api/get-user-problem-status', {
      method: 'POST',
      body: { pidList, isContestProblemList, cid: cid ?? null, gid: gid ?? null, containsEnd },
    });
  }

  async getTrainingList(params: { currentPage?: number; limit?: number; keyword?: string } = {}): Promise<Paged<TrainingInfo>> {
    return this.request('/api/get-training-list', { query: params });
  }

  async getTrainingDetail(tid: number): Promise<TrainingInfo> {
    return this.request('/api/get-training-detail', { query: { tid } });
  }

  async getTrainingProblemList(tid: number): Promise<any[]> {
    return this.request('/api/get-training-problem-list', { query: { tid } });
  }

  /**
   * Recommendation service "learning map": the student's course, knowledge points (chapters),
   * and per-knowledge-point homework / practice / recommended problems plus progress.
   */
  async getLearningMap(userId: string | number): Promise<any> {
    return this.request(`/recommendation-api/learning-map/${encodeURIComponent(String(userId))}`);
  }

  async getLanguages(all = false): Promise<Language[]> {
    return this.request('/api/languages', { query: { all }, auth: false });
  }

  // ---- Judge / submission ---------------------------------------------------
  async submit(params: {
    pid: string;
    language: string;
    code: string;
    cid?: number;
    tid?: number;
    gid?: number;
    isRemote?: boolean;
  }): Promise<Judge> {
    return this.request('/api/submit-problem-judge', {
      method: 'POST',
      body: {
        pid: params.pid,
        language: params.language,
        code: params.code,
        cid: params.cid ?? 0,
        tid: params.tid ?? null,
        gid: params.gid ?? null,
        isRemote: params.isRemote ?? false,
      },
    });
  }

  async getSubmissionDetail(submitId: number): Promise<SubmissionDetail> {
    return this.request('/api/get-submission-detail', { query: { submitId } });
  }

  /** The current user's most recent accepted (AC) code for a problem. Empty code means never AC. */
  async getUserLastAcceptedCode(
    pid: number,
    cid?: number,
  ): Promise<{ submitId?: number; code: string; language?: string }> {
    return this.request('/api/get-last-ac-code', { query: { pid, cid } });
  }

  async getAllCaseResult(submitId: number): Promise<JudgeCaseResult> {
    return this.request('/api/get-all-case-result', { query: { submitId } });
  }

  /** Submit an online (cloud) test-judge with a custom input; returns a testJudgeKey. */
  async submitTestJudge(params: {
    pid: number;
    language: string;
    code: string;
    userInput: string;
    expectedOutput?: string;
    type?: 'public' | 'contest' | 'group';
    mode?: string;
    isRemoteJudge?: boolean;
  }): Promise<string> {
    return this.request('/api/submit-problem-test-judge', {
      method: 'POST',
      body: {
        pid: params.pid,
        language: params.language,
        code: params.code,
        type: params.type || 'public',
        userInput: params.userInput,
        expectedOutput: params.expectedOutput ?? '',
        mode: params.mode ?? '',
        isRemoteJudge: params.isRemoteJudge ?? false,
      },
    });
  }

  /** Get the result of an online test-judge. status 5 = pending; otherwise done (key is then removed). */
  async getTestJudgeResult(testJudgeKey: string): Promise<any> {
    return this.request('/api/get-test-judge-result', { query: { testJudgeKey } });
  }

  async checkSubmissionsStatus(submitIds: number[], cid?: number): Promise<Record<string, any>> {
    return this.request('/api/check-submissions-status', {
      method: 'POST',
      body: { submitIds, cid: cid ?? 0 },
    });
  }

  async getSubmissionList(params: {
    limit?: number;
    currentPage?: number;
    onlyMine?: boolean;
    problemID?: string;
    completeProblemID?: boolean;
    status?: number;
    username?: string;
  } = {}): Promise<Paged<SubmissionRecord>> {
    return this.request('/api/get-submission-list', { query: params });
  }

  // ---- NUAA learning assistant (recommendation service) ---------------------
  async assistantContext(username: string, problemId: string, submitId?: string | number): Promise<any> {
    return this.request(`/recommendation-api/student/${encodeURIComponent(username)}/assistant/context`, {
      query: { problem_id: problemId, submit_id: submitId },
    });
  }

  async assistantSessions(username: string): Promise<any[]> {
    return this.request(`/recommendation-api/student/${encodeURIComponent(username)}/assistant/sessions`);
  }

  async assistantSession(username: string, sessionId: string): Promise<any[]> {
    return this.request(`/recommendation-api/student/${encodeURIComponent(username)}/assistant/session/${encodeURIComponent(sessionId)}`);
  }

  /**
   * Ask the assistant, consuming the SSE stream. Calls `onEvent` for each JSON
   * payload (`{t}` text chunk, `{meta}`, `{done:true}`, ...).
   */
  async assistantAskStream(
    username: string,
    body: any,
    onEvent: (ev: any) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = this.buildUrl(`/recommendation-api/student/${encodeURIComponent(username)}/assistant/ask`);
    const token = this.getToken ? await this.getToken() : undefined;
    const headers: Record<string, string> = {
      'Url-Type': 'general',
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
    if (token) headers['Authorization'] = token;
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e: any) {
      throw new OjError(`无法连接助教服务：${e?.message ?? e}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new OjError(`助教服务返回 HTTP ${res.status} ${t.slice(0, 200)}`, res.status);
    }
    const parseBlock = (block: string) => {
      for (const line of block.split(/\r?\n/)) {
        const m = /^data:\s?(.*)$/.exec(line);
        if (!m) continue;
        const payload = m[1].trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          onEvent(JSON.parse(payload));
        } catch {
          onEvent({ t: payload });
        }
      }
    };
    const reader = res.body?.getReader();
    if (!reader) {
      parseBlock(await res.text());
      return;
    }
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        parseBlock(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    }
    if (buf.trim()) parseBlock(buf);
  }

  // ---- Ability profile & streaming advice -----------------------------------
  async studentProfile(username: string): Promise<any> {
    return this.request(`/recommendation-api/student_profile/${encodeURIComponent(username)}`);
  }

  private async streamGet(path: string, onEvent: (ev: any) => void, signal?: AbortSignal): Promise<void> {
    const url = this.buildUrl(path);
    const token = this.getToken ? await this.getToken() : undefined;
    const headers: Record<string, string> = { 'Url-Type': 'general', Accept: 'text/event-stream' };
    if (token) headers['Authorization'] = token;
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers, signal });
    } catch (e: any) {
      throw new OjError(`无法连接服务：${e?.message ?? e}`);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new OjError(`服务返回 HTTP ${res.status} ${t.slice(0, 200)}`, res.status);
    }
    const parseBlock = (block: string) => {
      for (const line of block.split(/\r?\n/)) {
        const m = /^data:\s?(.*)$/.exec(line);
        if (!m) continue;
        const payload = m[1].trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          onEvent(JSON.parse(payload));
        } catch {
          onEvent({ t: payload });
        }
      }
    };
    const reader = res.body?.getReader();
    if (!reader) {
      parseBlock(await res.text());
      return;
    }
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        parseBlock(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
      }
    }
    if (buf.trim()) parseBlock(buf);
  }

  async adviceKnowledgeStream(username: string, onEvent: (ev: any) => void, signal?: AbortSignal): Promise<void> {
    return this.streamGet(`/recommendation-api/student/${encodeURIComponent(username)}/advice/knowledge/stream`, onEvent, signal);
  }

  async adviceMethodStream(username: string, onEvent: (ev: any) => void, signal?: AbortSignal): Promise<void> {
    return this.streamGet(`/recommendation-api/student/${encodeURIComponent(username)}/advice/method/stream`, onEvent, signal);
  }
}
