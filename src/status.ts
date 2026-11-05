// HOJ judge status constants (see Constants.Judge in the backend).
export interface StatusMeta {
  name: string;
  short: string;
  color: string; // css color
  final: boolean;
}

const STATUS: Record<number, StatusMeta> = {
  [-10]: { name: 'Not Submitted', short: 'N/A', color: '#9e9e9e', final: true },
  [-5]: { name: 'Submitted Unknown Result', short: 'UNK', color: '#9e9e9e', final: true },
  [-4]: { name: 'Cancelled', short: 'CA', color: '#9e9e9e', final: true },
  [-3]: { name: 'Presentation Error', short: 'PE', color: '#e6a23c', final: true },
  [-2]: { name: 'Compile Error', short: 'CE', color: '#e6a23c', final: true },
  [-1]: { name: 'Wrong Answer', short: 'WA', color: '#f56c6c', final: true },
  [0]: { name: 'Accepted', short: 'AC', color: '#67c23a', final: true },
  [1]: { name: 'Time Limit Exceeded', short: 'TLE', color: '#f56c6c', final: true },
  [2]: { name: 'Memory Limit Exceeded', short: 'MLE', color: '#f56c6c', final: true },
  [3]: { name: 'Runtime Error', short: 'RE', color: '#f56c6c', final: true },
  [4]: { name: 'System Error', short: 'SE', color: '#f56c6c', final: true },
  [5]: { name: 'Pending', short: 'PD', color: '#409eff', final: false },
  [6]: { name: 'Compiling', short: 'CP', color: '#409eff', final: false },
  [7]: { name: 'Judging', short: 'JG', color: '#409eff', final: false },
  [8]: { name: 'Partial Accepted', short: 'PA', color: '#e6a23c', final: true },
  [9]: { name: 'Submitting', short: 'SB', color: '#409eff', final: false },
  [10]: { name: 'Submitted Failed', short: 'SF', color: '#f56c6c', final: true },
  [15]: { name: 'No Status', short: '—', color: '#9e9e9e', final: true },
};

export function statusMeta(status: number | null | undefined): StatusMeta {
  if (status === null || status === undefined) {
    return { name: 'Unknown', short: '?', color: '#9e9e9e', final: true };
  }
  return STATUS[status] ?? { name: `Unknown(${status})`, short: `#${status}`, color: '#9e9e9e', final: true };
}

export function isFinalStatus(status: number | null | undefined): boolean {
  return statusMeta(status).final;
}
