// Live smoke test of the compiled HTTP client against the real OJ.
const { OjApi } = require('../out/api.js');
const { parseSamples } = require('../out/samples.js');

(async () => {
  const baseUrl = 'https://oj.nuaa.edu.cn';
  const api = new OjApi({ baseUrl });
  const { token, user } = await api.login('162610126', 'oj162610126oj');
  console.log('LOGIN ok. user=', user.username, 'nickname=', user.nickname, 'tokenLen=', token.length);

  const api2 = new OjApi({ baseUrl, getToken: () => token });

  const d = await api2.getProblemDetail('E1');
  console.log('PROBLEM E1:', d.problem.title, '|', d.problem.timeLimit + 'ms', d.problem.memoryLimit + 'MB', '| tags=', (d.tags || []).map(t => t.name).join(','));
  const samples = parseSamples(d.problem.examples);
  console.log('SAMPLES:', samples.length, JSON.stringify(samples));

  const td = await api2.getTrainingProblemDetail('9999', 8);
  console.log('TRAINING 9999:', td.problem.title, '| isFileIO=', td.problem.isFileIO, '| io=', td.problem.ioReadFileName, '->', td.problem.ioWriteFileName, '| samples=', parseSamples(td.problem.examples).length);

  const langs = await api2.getLanguages();
  console.log('LANGUAGES:', langs.map(l => l.name).join(', '));

  const subs = await api2.getSubmissionList({ limit: 3, currentPage: 1, onlyMine: true });
  console.log('SUBMISSIONS:', subs.records.map(r => `#${r.submitId} ${r.displayPid} status=${r.status} ${r.language}`).join(' | '));

  const det = await api2.getSubmissionDetail(180653);
  console.log('SUBMISSION 180653 status=', det.submission.status, 'time=', det.submission.time, 'mem=', det.submission.memory);

  const list = await api2.getProblemList({ currentPage: 1, limit: 3 });
  console.log('PROBLEM LIST total=', list.total, 'first=', list.records.map(r => r.problemId + ':' + r.title).join(' | '));

  console.log('\nALL SMOKE TESTS PASSED');
})().catch((e) => {
  console.error('SMOKE FAILED:', e && e.message ? e.message : e);
  process.exit(1);
});
