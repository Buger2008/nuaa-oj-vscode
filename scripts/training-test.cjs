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
      workspace: { getConfiguration: () => ({ get: (k, d) => d }) },
    };
  }
  return orig.apply(this, arguments);
};

const { OjApi } = require('../out/api.js');

(async () => {
  const api = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn' });
  const { token } = await api.login('162610126', 'oj162610126oj');
  const api2 = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn', getToken: () => token });
  const auth = { ensureLoggedIn: async () => true, api: api2 };

  const { TrainingProvider } = require('../out/tree.js');
  const p = new TrainingProvider(auth);

  const roots = await p.getChildren();
  console.log('ROOT count:', roots.length, '| kind:', roots[0] && roots[0].kind);
  console.log('ROOT labels:', roots.slice(0, 8).map((r) => r.label).join(' | '));

  let trainingNode = roots[0];
  if (roots[0] && roots[0].kind === 'category') {
    const kids = await p.getChildren(roots[0]);
    console.log('CATEGORY children:', kids.length, '|', kids.slice(0, 3).map((k) => k.label).join(' | '));
    trainingNode = kids[0];
  }
  console.log('TRAINING node:', trainingNode && trainingNode.label, 'kind=', trainingNode && trainingNode.kind, 'tid=', trainingNode && trainingNode.tid);

  const probs = await p.getChildren(trainingNode);
  console.log('PROBLEMS under training:', probs.length);
  console.log('first 5:', probs.slice(0, 5).map((x) => x.label).join(' | '));
  console.log('first problem command args:', probs[0] && probs[0].command && probs[0].command.arguments);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
