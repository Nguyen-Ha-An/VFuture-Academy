import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/*
 * The content engine renders in four token scopes (learner bench, staff, the Studio preview
 * island and public prose), so renderers may only use semantic token utilities. The learner
 * surfaces (DESIGN.md) follow the same rule. This guard scans the source text of every renderer
 * and learner surface and fails on Tailwind palette colours, on raw white/black utilities, on
 * border widths without a colour (Tailwind v4 draws a bare `border` in currentColor) and on the
 * undefined `var(--signal)`.
 */
const RENDER_ROOTS = [join(process.cwd(), 'src', 'content-engine', 'render')];
/** Learner surfaces: the workspace kit, learner views and the `/app` routes. */
const LEARNER_ROOTS = [
  ['src', 'features', 'learner', 'ui'],
  ['src', 'features', 'workspace-ui'],
  ['src', 'features', 'projects', 'ui'],
  ['src', 'features', 'exams', 'ui'],
  ['src', 'features', 'notebooks', 'ui'],
  ['src', 'features', 'opportunities', 'ui'],
  ['src', 'app', 'app'],
].map((parts) => join(process.cwd(), ...parts));
/** Studio and grading files that live beside learner code but render in the staff scope. */
const STAFF_ONLY = new Set([
  'src/features/projects/ui/StudioProjectForm.tsx',
  'src/features/notebooks/ui/StudioNotebookEntry.tsx',
  'src/features/notebooks/ui/NotebookSubmissionPreview.tsx',
  'src/features/opportunities/ui/OpportunityEditor.tsx',
]);
const isStaffOnly = (file: string) => STAFF_ONLY.has(file) || /(^|\/)studio(\/|$)/i.test(file);
/** `file:utility` pairs allowed to keep a raw white/black utility. */
const WHITE_BLACK_ALLOWED = new Set(['src/content-engine/render/blocks/Video.tsx:bg-black']);

const PALETTE = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOUR_UTILITY = 'bg|text|border(?:-[xytrblse])?|divide|ring|ring-offset|outline|decoration|placeholder|caret|accent|fill|stroke|from|via|to|shadow';
const PALETTE_RE = new RegExp(`(?<![\\w-])((?:[\\w\\[\\]&=:*>+~.-]+:)*(?:${COLOUR_UTILITY})-(?:${PALETTE})-\\d{2,3}(?:\\/\\d+)?)(?![\\w-])`, 'g');
const WHITE_BLACK_RE = /(?<![\w-])((?:[\w[\]&=:*>+~.-]+:)*(bg|text|border)-(white|black)(?:\/\d+)?)(?![\w-])/g;
/** Border widths; group 1 is the variant prefix (`sm:`, `aria-[current=page]:`), empty when bare. */
const BORDER_WIDTH_RE = /(?<![\w-])((?:[\w[\]&=:*>+~.-]+:)*)(?:border(?:-[xytrblse])?(?:-(?:2|4|8))?|divide-[xy](?:-(?:2|4|8))?)(?![\w-])/g;
const TOKENS = 'border|input|primary|ring|foreground|muted-foreground|destructive|success-border|warning-border|info-border|transparent';
/** Semantic border colours; group 1 is the variant prefix, as above. */
const BORDER_COLOUR_RE = new RegExp(`(?<![\\w-])((?:[\\w\\[\\]&=:*>+~.-]+:)*)(?:border(?:-[xytrblse])?|divide)-(?:${TOKENS})(?:\\/\\d+)?(?![\\w-])`, 'g');
/** Interpolated tone maps (`tone`, `questionTone(...)`, `blockFrame(depth)`) carry the colour. */
const TONE_REF_RE = /\b\w*(?:tone|Tone|frame|Frame)\b/;

type Literal = { text: string; line: number };

/**
 * Collects every string and template literal in a TS/TSX source. A template literal keeps
 * its `${...}` expressions in `text` so a colour supplied by an interpolated tone counts as
 * part of the same class string; nested literals inside expressions are collected too.
 * Comments are skipped, and a quote that reaches the end of a line (JSX text such as
 * "don't") is not a string.
 */
export function literals(src: string): Literal[] {
  const out: Literal[] = [];
  const lineAt = (i: number) => src.slice(0, i).split('\n').length;
  const readQuoted = (start: number): number => {
    const quote = src[start];
    let i = start + 1;
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\n') return start + 1;
      i += src[i] === '\\' ? 2 : 1;
    }
    out.push({ text: src.slice(start + 1, i), line: lineAt(start) });
    return i + 1;
  };
  const readTemplate = (start: number): number => {
    let i = start + 1;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') { i = readCode(i + 2, true); continue; }
      i += 1;
    }
    out.push({ text: src.slice(start + 1, i), line: lineAt(start) });
    return i + 1;
  };
  function readCode(start: number, nested: boolean): number {
    let depth = 0;
    let i = start;
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { const end = src.indexOf('\n', i); i = end === -1 ? src.length : end; continue; }
      if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? src.length : end + 2; continue; }
      if (c === '"' || c === "'") { i = readQuoted(i); continue; }
      if (c === '`') { i = readTemplate(i); continue; }
      if (nested && c === '{') depth += 1;
      if (nested && c === '}') { if (depth === 0) return i + 1; depth -= 1; }
      i += 1;
    }
    return i;
  }
  readCode(0, false);
  return out;
}

/**
 * A border width needs a semantic colour that applies wherever the width does: a bare colour
 * token, or one under the same variant prefix (`sm:border-l sm:border-border`).
 */
function uncolouredBorder(text: string): boolean {
  const colours = new Set([...text.matchAll(BORDER_COLOUR_RE)].map((m) => m[1]));
  if (colours.has('')) return false;
  return [...text.matchAll(BORDER_WIDTH_RE)].some((m) => !colours.has(m[1]));
}

export function paletteViolations(file: string, src: string): string[] {
  const found: string[] = [];
  for (const { text, line } of literals(src)) {
    for (const m of text.matchAll(PALETTE_RE)) found.push(`${file}:${line} palette colour ${m[1]}`);
    for (const m of text.matchAll(WHITE_BLACK_RE)) {
      const bare = `${m[2]}-${m[3]}`;
      if (m[1] !== bare || !WHITE_BLACK_ALLOWED.has(`${file}:${bare}`)) found.push(`${file}:${line} raw ${m[1]}`);
    }
    if (uncolouredBorder(text) && !(text.includes('${') && TONE_REF_RE.test(text))) found.push(`${file}:${line} border without a colour token: "${text}"`);
  }
  if (src.includes('var(--signal)')) found.push(`${file}: var(--signal) is undefined outside public prose`);
  return [...new Set(found)];
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.tsx?$/.test(full) ? [full] : [];
  });
}

describe('render palette guard', () => {
  it('catches palette colours in every variant, raw white/black, uncoloured borders and var(--signal)', () => {
    const sample = [
      `const a = 'bg-neutral-200 hover:bg-neutral-50 odd:bg-neutral-50 even:bg-sky-50 focus:border-sky-500 text-emerald-700/80';`,
      `const b = 'text-white bg-black/50 hover:text-white';`,
      `const c = 'rounded-md border p-4'; const d = 'divide-y'; const e = 'border-l-4 border-info-border';`,
      `const f = \`rounded border \${active ? 'border-primary' : 'border-border'}\`; const g = \`border-t \${tone}\`; const h = \`border-b-2 \${x}\`;`,
      `const i = 'text-[color:var(--signal)]';`,
    ].join('\n');
    const found = paletteViolations('x.tsx', sample);
    for (const cls of ['bg-neutral-200', 'hover:bg-neutral-50', 'odd:bg-neutral-50', 'even:bg-sky-50', 'focus:border-sky-500', 'text-emerald-700/80']) expect(found).toContain(`x.tsx:1 palette colour ${cls}`);
    for (const cls of ['text-white', 'bg-black/50', 'hover:text-white']) expect(found).toContain(`x.tsx:2 raw ${cls}`);
    expect(found.filter((f) => f.includes('border without a colour'))).toEqual([
      'x.tsx:3 border without a colour token: "rounded-md border p-4"',
      'x.tsx:3 border without a colour token: "divide-y"',
      'x.tsx:4 border without a colour token: "border-b-2 ${x}"',
    ]);
    expect(found).toContain('x.tsx: var(--signal) is undefined outside public prose');
  });

  it('allows only Video bg-black and never reads comments or JSX text as strings', () => {
    expect(paletteViolations('src/content-engine/render/blocks/Video.tsx', `const v = 'rounded-md bg-black';`)).toEqual([]);
    expect(paletteViolations('src/content-engine/render/blocks/Other.tsx', `const v = 'bg-black';`)).toEqual(['src/content-engine/render/blocks/Other.tsx:1 raw bg-black']);
    expect(paletteViolations('y.tsx', `// don't use 'bg-red-50'\n/* 'border' */\nconst j = <p>Don't</p>; const k = 'border-dashed border-border';`)).toEqual([]);
  });

  it('accepts a border colour under the same variant prefix as the width', () => {
    expect(paletteViolations('z.tsx', `const a = 'sm:border-l sm:border-border'; const b = 'aria-[current=page]:border-b-2 aria-[current=page]:border-primary'; const c = 'min-[760px]:border-l border-border';`)).toEqual([]);
    expect(paletteViolations('z.tsx', `const d = 'sm:border-l hover:border-border';`)).toEqual(['z.tsx:1 border without a colour token: "sm:border-l hover:border-border"']);
    expect(paletteViolations('z.tsx', `const e = 'border sm:border-border';`)).toEqual(['z.tsx:1 border without a colour token: "border sm:border-border"']);
  });

  it('keeps every renderer on semantic tokens', () => {
    const offenders = RENDER_ROOTS.flatMap((root) => files(root)).flatMap((file) => paletteViolations(relative(process.cwd(), file).replaceAll('\\', '/'), readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('keeps every learner surface on semantic tokens', () => {
    const offenders = LEARNER_ROOTS.flatMap((root) => files(root))
      .map((file) => relative(process.cwd(), file).replaceAll('\\', '/'))
      .filter((file) => !isStaffOnly(file))
      .flatMap((file) => paletteViolations(file, readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
