const Module = require('module');
const orig = Module._load;
class EventEmitter { constructor(){ this.event = () => ({ dispose(){} }); } fire(){} dispose(){} }
class TreeItem { constructor(l, s){ this.label = l; this.collapsibleState = s; } }
class ThemeIcon { constructor(id){ this.id = id; } }
Module._load = function (r) {
  if (r === 'vscode') return { EventEmitter, TreeItem, ThemeIcon, TreeItemCollapsibleState: { None:0, Collapsed:1, Expanded:2 }, workspace: { getConfiguration: () => ({ get:(k,d)=>d }) } };
  return orig.apply(this, arguments);
};
const { OjApi } = require('../out/api.js');
(async () => {
  const api = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn' });
  const { token } = await api.login('162610126', 'oj162610126oj');
  const api2 = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn', getToken: () => token });
  const auth = { ensureLoggedIn: async () => true, api: api2 };
  const { ProblemsProvider } = require('../out/tree.js');
  const p = new ProblemsProvider(auth);
  await p.load();
  const items = p.getChildren();
  console.log('PROBLEM LIST loaded:', items.length);
  console.log('first:', items[0] && items[0].label);
  console.log('last:', items[items.length-1] && items[items.length-1].label);
  // sanity: search
  await p.load('A+B');
  console.log('search "A+B" ->', p.getChildren().length, 'items');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
