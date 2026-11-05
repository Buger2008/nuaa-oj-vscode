// Extract "code to be modified" from a problem's description (Markdown fenced blocks or <pre>).

function family(language: string): string {
  const s = (language || '').toLowerCase();
  if (s === 'c' || s === 'c with o2') return 'c';
  if (s.includes('c++') || s === 'cpp') return 'cpp';
  if (s.includes('java')) return 'java';
  if (s.includes('python') || s.includes('pypy')) return 'python';
  if (s.includes('golang') || s === 'go') return 'go';
  if (s.includes('c#')) return 'csharp';
  if (s.includes('php')) return 'php';
  if (s.includes('javascript')) return 'js';
  if (s.includes('ruby')) return 'ruby';
  if (s.includes('rust')) return 'rust';
  return s;
}

function fenceFamily(tag: string): string {
  const t = (tag || '').toLowerCase().trim();
  if (t === 'c') return 'c';
  if (t === 'cpp' || t === 'c++' || t === 'cc' || t === 'cxx' || t === 'hpp') return 'cpp';
  if (t === 'java') return 'java';
  if (t === 'python' || t === 'py' || t === 'python3') return 'python';
  if (t === 'go' || t === 'golang') return 'go';
  if (t === 'cs' || t === 'csharp' || t === 'c#') return 'csharp';
  if (t === 'php') return 'php';
  if (t === 'js' || t === 'javascript' || t === 'node') return 'js';
  if (t === 'rb' || t === 'ruby') return 'ruby';
  if (t === 'rs' || t === 'rust') return 'rust';
  return t;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

interface Block {
  family: string;
  code: string;
}

/** Collect code blocks from markdown fences and <pre> tags. */
function collectBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  // Markdown fenced blocks: ```lang\n ... ```
  const fenceRe = /```([a-zA-Z0-9+#.\-]*)[ \t]*\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(html)) !== null) {
    blocks.push({ family: fenceFamily(m[1]), code: m[2].replace(/\r\n/g, '\n') });
  }
  // <pre>...</pre> (no language tag)
  const preRe = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  while ((m = preRe.exec(html)) !== null) {
    let code = m[1].replace(/<\s*br\s*\/?\s*>/gi, '\n');
    code = decodeEntities(code.replace(/<[^>]+>/g, ''));
    blocks.push({ family: '', code: code.replace(/\r\n/g, '\n') });
  }
  return blocks;
}

function looksLikeProgram(code: string): boolean {
  return /\b(main\s*\(|#include|public\s+class|def\s+\w+\s*\(|system\.out|printf|scanf|cin|cout|std::)/.test(code);
}

/**
 * Return the code block that should seed a new file for `language`, or undefined
 * when the problem has no obvious "code to modify".
 */
export function extractTemplateCode(description: string | undefined | null, language: string): string | undefined {
  if (!description) return undefined;
  const blocks = collectBlocks(description).filter((b) => b.code.trim());
  if (!blocks.length) return undefined;
  const target = family(language);

  // 1) Prefer a fenced block whose language matches the target language.
  const exact = blocks.find((b) => b.family && b.family === target);
  if (exact) return exact.code;

  // 2) A language-less block that clearly looks like a program (e.g., <pre>).
  const generic = blocks.find((b) => !b.family && looksLikeProgram(b.code));
  if (generic) return generic.code;

  // 3) If there is exactly one fenced block that looks like a program, use it.
  const programFences = blocks.filter((b) => b.family && looksLikeProgram(b.code));
  if (programFences.length === 1) return programFences[0].code;

  return undefined;
}
