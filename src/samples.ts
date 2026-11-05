export interface Sample {
  input: string;
  output: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeFromCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/** Convert HOJ's `examples` HTML fragment into plain text. */
export function htmlToText(html: string | undefined | null): string {
  if (!html) return '';
  let s = html;
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*\/\s*p\s*>/gi, '\n');
  s = s.replace(/<\s*pre[^>]*>/gi, '').replace(/<\s*\/\s*pre\s*>/gi, '');
  s = decodeEntities(s);
  s = s.replace(/<[^>]+>/g, ''); // strip remaining tags
  return s.replace(/\r\n/g, '\n');
}

/**
 * Parse the HOJ `examples` field, which looks like:
 *   <input>1 5</input><output>6</output><input>10 20</input><output>30</output>
 * into an ordered list of input/output pairs.
 */
export function parseSamples(examples: string | undefined | null): Sample[] {
  if (!examples) return [];
  const samples: Sample[] = [];
  const pairRe = /<input[^>]*>([\s\S]*?)<\/input>\s*<output[^>]*>([\s\S]*?)<\/output>/gi;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(examples)) !== null) {
    samples.push({ input: htmlToText(m[1]), output: htmlToText(m[2]) });
  }
  if (samples.length === 0) {
    // Fallback: separate inputs and outputs independently.
    const inputs = [...examples.matchAll(/<input[^>]*>([\s\S]*?)<\/input>/gi)].map((x) => htmlToText(x[1]));
    const outputs = [...examples.matchAll(/<output[^>]*>([\s\S]*?)<\/output>/gi)].map((x) => htmlToText(x[1]));
    for (let i = 0; i < Math.min(inputs.length, outputs.length); i++) {
      samples.push({ input: inputs[i], output: outputs[i] });
    }
  }
  return samples;
}
