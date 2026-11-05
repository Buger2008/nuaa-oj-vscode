// Validate the Markdown+KaTeX rendering algorithm (same regex as the webview) headlessly.
const MarkdownIt = require('markdown-it');
const katex = require('katex');
const { OjApi } = require('../out/api.js');

const md = new MarkdownIt({ html: true, linkify: true, breaks: true });

function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function renderMixed(text){
  if(!text) return '';
  const store = [];
  let s = text;
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m,t)=>{ store.push({t,d:true}); return '@@MATH'+(store.length-1)+'@@'; });
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m,t)=>{ store.push({t,d:true}); return '@@MATH'+(store.length-1)+'@@'; });
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m,t)=>{ store.push({t,d:false}); return '@@MATH'+(store.length-1)+'@@'; });
  s = s.replace(/(^|[^\\$])\$([^\$\n]+?)\$/g, (m,pre,t)=>{ store.push({t,d:false}); return pre+'@@MATH'+(store.length-1)+'@@'; });
  let html = md.render(s);
  html = html.replace(/@@MATH(\d+)@@/g, (m, idx)=>{ const o = store[+idx]; try { return katex.renderToString(o.t,{displayMode:o.d,throwOnError:false}); } catch(e){ return '<code>'+escapeHtml(o.t)+'</code>'; } });
  return html;
}

(async () => {
  const api = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn' });
  const { token } = await api.login('162610126', 'oj162610126oj');
  const api2 = new OjApi({ baseUrl: 'https://oj.nuaa.edu.cn', getToken: () => token });

  const d = await api2.getProblemDetail('NUAA2023_J');
  const desc = d.problem.description;
  console.log('RAW has $:', desc.includes('$'), '| has ***:', desc.includes('***'));
  const html = renderMixed(desc);
  console.log('RENDERED contains katex:', html.includes('katex'));
  console.log('RENDERED still has literal $S$:', html.includes('$S$'));
  console.log('RENDERED has <strong> or <em>:', /<(strong|em)>/.test(html));
  // Show a snippet around first katex
  const i = html.indexOf('katex');
  console.log('SNIPPET:', html.slice(Math.max(0,i-60), i+220).replace(/\n/g,' '));

  const hq = await api2.getProblemDetail('HQ-4-9');
  const hqHtml = renderMixed(hq.problem.description);
  console.log('\nHQ-4-9 code fence -> <pre><code>:', /<pre><code/.test(hqHtml), '| has int main:', hqHtml.includes('int main'));
})().catch(e => { console.error('FAILED', e); process.exit(1); });
