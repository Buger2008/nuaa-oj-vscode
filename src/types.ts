// Types mirroring the HOJ (NUAA OJ) backend DTOs. Intentionally permissive.

export interface UserInfo {
  uid: string;
  username: string;
  nickname?: string | null;
  avatar?: string | null;
  email?: string | null;
  number?: string | null;
  school?: string | null;
  gender?: string | null;
  realname?: string | null;
  roleList?: string[];
  [k: string]: any;
}

export interface Tag {
  id: number;
  name: string;
  color?: string | null;
  oj?: string | null;
  [k: string]: any;
}

export interface Problem {
  id: number;            // internal numeric id
  problemId: string;     // display id, e.g. "E1" / "9999"
  title: string;
  author?: string;
  type?: number;
  judgeMode?: string;
  judgeCaseMode?: string;
  timeLimit: number;     // ms
  memoryLimit: number;   // MB
  stackLimit?: number;
  description?: string;
  input?: string;
  output?: string;
  examples?: string;
  hint?: string;
  source?: string;
  difficulty?: number;
  auth?: number;
  isRemote?: boolean;
  isFileIO?: boolean;
  ioReadFileName?: string | null;
  ioWriteFileName?: string | null;
  openCaseResult?: boolean;
  isRemoveEndBlank?: boolean;
  gid?: number | null;
  isGroup?: boolean;
  [k: string]: any;
}

export interface ProblemDetail {
  problem: Problem;
  tags: Tag[];
  languages?: string[];
  [k: string]: any;
}

export interface Judge {
  submitId: number;
  pid: number;
  displayPid?: string;
  uid?: string;
  username?: string;
  submitTime?: string;
  status: number;
  errorMessage?: string | null;
  time?: number | null;
  memory?: number | null;
  score?: number | null;
  length?: number;
  code?: string;
  language?: string;
  cid?: number;
  cpid?: number;
  gid?: number | null;
  judger?: string | null;
  [k: string]: any;
}

export interface SubmissionDetail {
  submission: Judge;
  codeShare?: boolean;
  canViewCode?: boolean;
}

export interface JudgeCase {
  seq?: number;
  groupNum?: number;
  status: number;
  time?: number;
  memory?: number;
  score?: number;
  mode?: string;
  [k: string]: any;
}

export interface JudgeCaseResult {
  judgeCaseList?: JudgeCase[] | null;
  subTaskJudgeCaseList?: JudgeCase[] | null;
  judgeCaseMode?: string;
  [k: string]: any;
}

export interface Language {
  id: number;
  name: string;
  contentType: string;
  description?: string;
  [k: string]: any;
}

export interface Paged<T> {
  records: T[];
  total: number;
  size: number;
  current: number;
  pages: number;
  [k: string]: any;
}

export interface SubmissionRecord {
  submitId: number;
  pid: number;
  displayPid?: string;
  title: string;
  submitTime: string;
  status: number;
  time?: number | null;
  memory?: number | null;
  score?: number | null;
  language?: string;
  cid?: number;
  [k: string]: any;
}

export interface TrainingInfo {
  id: number;
  title: string;
  description?: string;
  author?: string;
  auth?: string;
  problemCount?: number;
  categoryName?: string;
  [k: string]: any;
}
