// Rendered inside the problem webview. Plain JS (not a template), so regexes are safe.
// Renders Markdown + LaTeX (KaTeX). Reads window.__RAW__ = {description,input,output,hint}.
(function () {
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function getMd() {
    if (window.__MD__ !== undefined) return window.__MD__;
    window.__MD__ = window.markdownit ? window.markdownit({ html: true, linkify: true, breaks: true }) : null;
    return window.__MD__;
  }

  // TeX control words followed by a letter are read as one longer command (e.g. "\leN",
  // "\simn" become undefined commands), so they stop rendering. Use KaTeX itself as the
  // oracle: for a "\letters" token that is not a valid command, find the longest valid
  // command prefix and insert a space after it ("\simn" -> "\sim n", "\leN" -> "\le N").
  var cmdValidCache = {};
  function isValidCommand(name) {
    if (!name) return false;
    if (Object.prototype.hasOwnProperty.call(cmdValidCache, name)) return cmdValidCache[name];
    var ok = false;
    try {
      window.katex.renderToString('\\' + name, { throwOnError: true });
      ok = true;
    } catch (e) {
      ok = false;
    }
    cmdValidCache[name] = ok;
    return ok;
  }
  function fixTexSpacing(t) {
    return t.replace(/\\([a-zA-Z]+)/g, function (m, name) {
      if (isValidCommand(name)) return m;
      for (var L = name.length - 1; L >= 1; L--) {
        var prefix = name.slice(0, L);
        if (isValidCommand(prefix)) return '\\' + prefix + ' ' + name.slice(L);
      }
      return m;
    });
  }

  // Rich-text editors wrap pieces of the formula in <span style=...>. Strip tags/entities so
  // KaTeX receives clean TeX (e.g. "$1<span>\le</span>|S|..." -> "1\le|S|...").
  function cleanMath(s) {
    if (!s) return '';
    s = s.replace(/<br\s*\/?>/gi, ' ');
    s = s.replace(/<[^>]*>/g, '');
    s = s.replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, function (_m, h) { try { return String.fromCodePoint(parseInt(h, 16)); } catch (e) { return ''; } })
      .replace(/&#(\d+);/g, function (_m, d) { try { return String.fromCodePoint(parseInt(d, 10)); } catch (e) { return ''; } })
      .replace(/&amp;/g, '&');
    return fixTexSpacing(s.trim());
  }

  // Convert rich-text HTML wrappers to plain text so standard Markdown (bold/italic/lists)
  // inside can be parsed. Only unwraps span/p/div and turns <br> into newlines; keeps
  // other inline HTML (links, images) intact.
  function deHtml(s) {
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/p\s*>/gi, '\n\n').replace(/<p[^>]*>/gi, '');
    s = s.replace(/<\/div\s*>/gi, '\n').replace(/<div[^>]*>/gi, '');
    s = s.replace(/<\/?span[^>]*>/gi, '');
    return s;
  }

  // The rich-text source sometimes has unbalanced emphasis like "***X**" (missing one closing *).
  // Balanced markdown parses emphasis across the whole block, so one imbalance leaves stray "*"
  // later. Downgrade "***X**" (not followed by another *) to "**X**" (bold) to keep things sane.
  function balanceEmphasis(s) {
    return s.replace(/\*\*\*([^*\n]+?)\*\*(?!\*)/g, '**$1**');
  }

  function renderMixed(text) {
    if (!text) return '';
    var md = getMd();
    if (!md || !window.katex) {
      return '<pre class="io">' + escapeHtml(text) + '</pre>';
    }
    var store = [];
    var s = text;
    // Block math: $$...$$ and \[...\]
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, function (m, t) { store.push({ t: cleanMath(t), d: true }); return '@@MATH' + (store.length - 1) + '@@'; });
    s = s.replace(/\\\[([\s\S]+?)\\\]/g, function (m, t) { store.push({ t: cleanMath(t), d: true }); return '@@MATH' + (store.length - 1) + '@@'; });
    // Inline math: \(...\) and $...$ (avoid escaped \$ and $$)
    s = s.replace(/\\\(([\s\S]+?)\\\)/g, function (m, t) { store.push({ t: cleanMath(t), d: false }); return '@@MATH' + (store.length - 1) + '@@'; });
    s = s.replace(/(^|[^\\$])\$([^\n]+?)\$/g, function (m, pre, t) { store.push({ t: cleanMath(t), d: false }); return pre + '@@MATH' + (store.length - 1) + '@@'; });

    s = balanceEmphasis(deHtml(s));
    var html = md.render(s);
    html = html.replace(/@@MATH(\d+)@@/g, function (m, idx) {
      var o = store[+idx];
      try {
        return window.katex.renderToString(o.t, { displayMode: o.d, throwOnError: false });
      } catch (e) {
        return '<code>' + escapeHtml(o.t) + '</code>';
      }
    });
    return html;
  }

  function run() {
    var RAW = window.__RAW__ || {};
    ['description', 'input', 'output', 'hint'].forEach(function (k) {
      var el = document.getElementById('sec-' + k);
      if (el) el.innerHTML = renderMixed(RAW[k] || '');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
