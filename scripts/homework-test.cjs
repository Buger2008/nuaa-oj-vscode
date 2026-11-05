const Module = require('module');
const orig = Module._load;
class EventEmitter { constructor(){ this.event = () => ({ dispose(){} }); } fire(){} dispose(){} }
class TreeItem { constructor(l, s){ this.label = l; this.collapsibleState = s; } }
class ThemeIcon { constructor(id){ this.id = id; } }
Module._load = function (r) {
  if (r === 'vscode') {
    return {
      EventEmitter, TreeItem, ThemeIcon,
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      workspace: { getConfiguration: () => ({ get: (k, d) => (k === 'nuaaOj.baseUrl' ? 'https://oj.nuaa.edu.cn' : d) }) },
    };
  }
  return orig.apply(this, arguments);
};

const { OjApi } = require('../out/api.js');

(async () => {
  const api = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn' });
  const { token, user } = await api.login('162610126', 'oj162610126oj');
  const api2 = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn', getToken: () => token });
  const auth = { ensureLoggedIn: async () => true, api: api2, currentUser: user };

  const { HomeworkProvider } = require('../out/tree.js');
  const p = new HomeworkProvider(auth);

  const stages = await p.getChildren();
  console.log('HOMEWORK stages count:', stages.length);
  for (const s of stages.slice(0, 8)) console.log('  -', s.label, '|', s.description, '| kind=', s.kind);

  const first = stages[0];
  const kids = await p.getChildren(first);
  console.log(`\nFirst stage [${first.label}] children:`, kids.length);
  for (const k of kids.slice(0, 8)) console.log('   *', k.label, '|', k.description, '| cmd=', k.command && k.command.arguments, '| icon=', k.iconPath && k.iconPath.id);

  // find a practice folder
  const practiceFolder = kids.find((k) => k.kind === 'practice');
  if (practiceFolder) {
    const pr = await p.getChildren(practiceFolder);
    console.log('\nPractice folder items:', pr.length, pr.slice(0, 3).map((x) => x.label));
  }
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
