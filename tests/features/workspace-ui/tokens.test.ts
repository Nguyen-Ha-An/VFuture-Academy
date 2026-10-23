import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');
const workspaceCss = read('src/features/workspace-ui/workspace.css');
const learnerCss = read('src/features/workspace-ui/learner/learner.css');
const publicCss = read('src/features/public-site/public-site.css');
const globalsCss = read('src/app/globals.css');

type Block = { prelude: string; decls: Map<string, string>; children: Block[] };

/** Minimal brace parser (same approach as staff-ui/tokens.test.ts): no strings containing braces. */
function parse(css: string): Block[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let index = 0;
  function readBlock(prelude: string): Block {
    const block: Block = { prelude, decls: new Map(), children: [] };
    let buffer = '';
    while (index < source.length) {
      const char = source[index++];
      if (char === '{') {
        block.children.push(readBlock(buffer.trim().replace(/\s+/g, ' ')));
        buffer = '';
      } else if (char === '}') {
        break;
      } else if (char === ';') {
        addDecl(block, buffer);
        buffer = '';
      } else {
        buffer += char;
      }
    }
    addDecl(block, buffer);
    return block;
  }
  function addDecl(block: Block, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const colon = trimmed.indexOf(':');
    block.decls.set(trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim());
  }
  return readBlock('').children;
}

/** Splits a selector list on top-level commas (commas inside :is()/:not() stay put). */
function splitSelectors(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts;
}

type Specificity = [number, number, number];
const add = (a: Specificity, b: Specificity): Specificity => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const compare = (a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const max = (list: Specificity[]) => list.reduce((best, next) => (compare(next, best) > 0 ? next : best), [0, 0, 0] as Specificity);

/** Selectors Level 4 specificity: :where() is zero; :is()/:not()/:has() take their most specific argument. */
function specificity(selector: string): Specificity {
  let total: Specificity = [0, 0, 0];
  let index = 0;
  const argument = () => {
    let depth = 1;
    const start = index;
    while (depth > 0) {
      const char = selector[index++];
      if (char === '(') depth++;
      if (char === ')') depth--;
    }
    return selector.slice(start, index - 1);
  };
  const name = () => {
    const start = index;
    while (index < selector.length && /[\w-]/.test(selector[index])) index++;
    return selector.slice(start, index);
  };
  while (index < selector.length) {
    const char = selector[index];
    if (char === '.') { index++; name(); total = add(total, [0, 1, 0]); }
    else if (char === '#') { index++; name(); total = add(total, [1, 0, 0]); }
    else if (char === '[') { index = selector.indexOf(']', index) + 1; total = add(total, [0, 1, 0]); }
    else if (selector.startsWith('::', index)) { index += 2; name(); total = add(total, [0, 0, 1]); }
    else if (char === ':') {
      index++;
      const pseudo = name();
      if (selector[index] === '(') {
        index++;
        const inner = argument();
        if (pseudo !== 'where') total = add(total, max(splitSelectors(inner).map(specificity)));
      } else {
        total = add(total, [0, 1, 0]);
      }
    } else if (/[a-zA-Z]/.test(char)) { name(); total = add(total, [0, 0, 1]); }
    else index++;
  }
  return total;
}

type Palette = Record<string, string>;
const find = (blocks: Block[], prelude: string) => blocks.find((block) => block.prelude === prelude);
const inMedia = (blocks: Block[], media: string, prelude: string) =>
  blocks.filter((block) => block.prelude === media).flatMap((block) => block.children).find((block) => block.prelude === prelude);
const LIGHT_MEDIA = '@media (prefers-color-scheme: light)';

const workspace = parse(workspaceCss);
const learner = parse(learnerCss);

const WS_DARK = ':root:has(.vf-workspace), .vf-workspace';
const WS_OS_LIGHT = ':root:has(.vf-workspace:not([data-theme="dark"])), .vf-workspace:not([data-theme="dark"])';
const WS_PINNED_LIGHT = ':root:has(.vf-workspace[data-theme="light"]), .vf-workspace[data-theme="light"]';
const L_SCOPE = ':root:has(.vf-workspace.vf-learner-refined), .vf-workspace.vf-learner-refined';
const L_OS_LIGHT = ':root:has(.vf-workspace.vf-learner-refined:not([data-theme="dark"])), .vf-workspace.vf-learner-refined:not([data-theme="dark"])';
const L_PINNED_LIGHT = ':root:has(.vf-workspace.vf-learner-refined[data-theme="light"]), .vf-workspace.vf-learner-refined[data-theme="light"]';

const wsDarkTokens = workspace.filter((block) => block.prelude === WS_DARK).find((block) => block.decls.has('--vf-bg'))!.decls;
const wsRepoint = workspace.filter((block) => block.prelude === WS_DARK).find((block) => block.decls.has('--background'))!.decls;
const wsOsLight = inMedia(workspace, LIGHT_MEDIA, WS_OS_LIGHT)!.decls;
const wsPinnedLight = find(workspace, WS_PINNED_LIGHT)!.decls;
const learnerScope = find(learner, L_SCOPE)!.decls;
const learnerOsLight = inMedia(learner, LIGHT_MEDIA, L_OS_LIGHT)!.decls;
const learnerPinnedLight = find(learner, L_PINNED_LIGHT)!.decls;

const palette = (...maps: Map<string, string>[]): Palette => Object.assign({}, ...maps.map((map) => Object.fromEntries(map)));
const dark = palette(wsDarkTokens);
const authLight = palette(wsDarkTokens, wsOsLight);
const learnerLight = palette(wsDarkTokens, wsOsLight, learnerOsLight);

type Rgb = [number, number, number];
function colour(value: string | undefined): { rgb: Rgb; alpha: number } {
  const hex = value?.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255) as Rgb, alpha: 1 };
  const rgb = value?.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)%\s*\)$/);
  if (rgb) return { rgb: [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255], alpha: Number(rgb[4]) / 100 };
  throw new Error(`expected a hex or rgb() colour, got ${value}`);
}
const over = (top: string | undefined, base: Rgb): Rgb => {
  const { rgb, alpha } = colour(top);
  return [0, 1, 2].map((i) => rgb[i] * alpha + base[i] * (1 - alpha)) as Rgb;
};
function luminance([red, green, blue]: Rgb): number {
  const [r, g, b] = [red, green, blue].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const contrast = (fg: string | undefined, bg: string | undefined) => ratio(colour(fg).rgb, colour(bg).rgb);

describe('workspace and learner token blocks', () => {
  it('writes the light theme once: OS-light and pinned-light blocks are identical', () => {
    expect(Object.fromEntries(wsOsLight)).toEqual(Object.fromEntries(wsPinnedLight));
    expect(Object.fromEntries(learnerOsLight)).toEqual(Object.fromEntries(learnerPinnedLight));
    expect(learnerOsLight.get('--vf-signal')).toBe('#08666a');
    expect([...learnerOsLight.keys()].sort()).toEqual(['--vf-grid', '--vf-signal', '--vf-signal-soft']);
  });

  it('gives the surface element the same values as the document (no hand-copied mirror)', () => {
    for (const prelude of [WS_DARK, WS_OS_LIGHT, WS_PINNED_LIGHT, L_SCOPE, L_OS_LIGHT, L_PINNED_LIGHT]) {
      const [root, element] = splitSelectors(prelude);
      expect(root.startsWith(':root:has(')).toBe(true);
      expect(root).toBe(`:root:has(${element})`);
    }
    // The only literal learner colours are the three light-signal tokens, in the two light blocks.
    expect(learnerCss.match(/--vf-(?:bg|surface|raised|line|ink|muted):/g)).toBeNull();
  });

  it('re-points --success, --warning and --info (and the shadcn tokens) on the document and the element', () => {
    for (const name of ['--background', '--foreground', '--card', '--primary', '--border', '--input', '--ring', '--success', '--warning', '--info', '--info-foreground', '--info-border']) {
      expect(wsRepoint.get(name), name).toBeTruthy();
    }
    expect(wsRepoint.get('--info')).toBe('var(--vf-signal-soft)');
    expect(wsRepoint.get('--info-foreground')).toBe('var(--vf-ink)');
    expect(wsRepoint.get('--info-border')).toBe('var(--vf-signal)');
  });

  it('sets the refined learner radii and frame tokens (DESIGN D2, D6)', () => {
    expect(Object.fromEntries([...learnerScope].filter(([name]) => /radius/.test(name)))).toEqual({
      '--radius': '6px', '--radius-xs': '2px', '--radius-sm': '4px', '--radius-md': '6px',
      '--radius-lg': '8px', '--radius-xl': '8px', '--radius-2xl': '8px', '--radius-3xl': '8px',
      '--vf-radius-card': '8px', '--vf-radius-control': '6px',
    });
    expect(learnerScope.get('--vf-col')).toBe('1080px');
    expect(learnerScope.get('--vf-aside')).toBe('280px');
    expect(learnerScope.get('--vf-col-gap')).toBe('24px');
    expect(learnerScope.get('--vf-bar-h')).toBe('56px');
  });

  it('keeps every learner token selector strictly more specific than workspace.css for the same property', () => {
    const declarers = (blocks: Block[]) => blocks.flatMap((block) => (block.prelude.startsWith('@media') ? block.children : [block]))
      .filter((block) => [...block.decls.keys()].some((name) => name.startsWith('--')));
    const workspaceBlocks = declarers(workspace);
    const learnerBlocks = declarers(learner).filter((block) => block.prelude.includes('.vf-learner-refined'));
    expect(learnerBlocks.length).toBeGreaterThanOrEqual(4);
    const kind = (selector: string) => (selector.startsWith(':root') ? 'root' : 'element');
    let checked = 0;
    for (const block of learnerBlocks) for (const name of block.decls.keys()) {
      const rivals = workspaceBlocks.filter((rival) => rival.decls.has(name));
      for (const selector of splitSelectors(block.prelude)) {
        const rivalSelectors = rivals.flatMap((rival) => splitSelectors(rival.prelude)).filter((rival) => kind(rival) === kind(selector));
        for (const rival of rivalSelectors) {
          expect(compare(specificity(selector), specificity(rival)), `${name}: ${selector} vs ${rival}`).toBeGreaterThan(0);
          checked++;
        }
      }
    }
    // --radius* and --vf-signal* each meet the workspace defaults.
    expect(checked).toBeGreaterThan(20);
    expect(compare(specificity(splitSelectors(L_SCOPE)[0]), specificity(':root:has(.vf-workspace)'))).toBeGreaterThan(0);
  });
});

describe('text contrast (WCAG AA 4.5:1)', () => {
  const themes: Array<[string, Palette]> = [['dark', dark], ['learner light', learnerLight], ['auth light', authLight]];
  for (const [theme, colours] of themes) {
    it(`${theme}: ink, muted and signal on bg, surface and raised`, () => {
      for (const text of ['--vf-ink', '--vf-muted', '--vf-signal']) for (const ground of ['--vf-bg', '--vf-surface', '--vf-raised']) {
        expect(contrast(colours[text], colours[ground]), `${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(colours['--vf-signal-ink'], colours['--vf-signal']), 'signal-ink on signal').toBeGreaterThanOrEqual(4.5);
    });
  }

  it('learner light signal stays AA on a selected row with a signal tag (two soft fills over the surface)', () => {
    const surface = colour(learnerLight['--vf-surface']).rgb;
    const stacked = over(learnerLight['--vf-signal-soft'], over(learnerLight['--vf-signal-soft'], surface));
    expect(learnerLight['--vf-signal']).toBe('#08666a');
    expect(ratio(colour(learnerLight['--vf-signal']).rgb, stacked)).toBeGreaterThanOrEqual(4.5);
  });

  it('public prose text pairs meet AA on the public reading palette', () => {
    const publicTree = parse(publicCss);
    const site = find(publicTree, '.public-site')!.decls;
    const prose = palette(...publicTree.filter((block) => block.prelude === '.public-site .public-prose').map((block) => block.decls));
    const resolve = (value: string | undefined): string | undefined => {
      const reference = value?.match(/^var\((--[\w-]+)\)$/);
      return reference ? resolve(site.get(reference[1]) ?? prose[reference[1]]) : value;
    };
    const pairs: Array<[string, string]> = [
      ['--foreground', '--background'], ['--foreground', '--card'],
      ['--muted-foreground', '--background'], ['--muted-foreground', '--card'],
      ['--primary', '--background'], ['--primary', '--card'], ['--primary-foreground', '--primary'],
      ['--accent-foreground', '--accent'],
      ['--destructive', '--background'], ['--destructive', '--card'],
      ['--success-foreground', '--success'], ['--warning-foreground', '--warning'], ['--info-foreground', '--info'],
      ['color', '--background'], ['color', '--card'],
    ];
    for (const [text, ground] of pairs) {
      expect(contrast(resolve(prose[text]), resolve(prose[ground])), `${text} on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('globals.css @layer base defaults', () => {
  const start = globalsCss.indexOf('@layer base {');
  const base = find(parse(globalsCss), '@layer base');

  it('reads the element tokens, never the --color-* theme variables', () => {
    expect(start).toBeGreaterThan(globalsCss.indexOf('@import "tailwindcss"'));
    expect(base).toBeDefined();
    const text = base!.children.map((rule) => `${rule.prelude}{${[...rule.decls].map(([k, v]) => `${k}:${v}`).join(';')}}`).join('\n');
    expect(text).not.toContain('--color-');
    expect(text).toContain('var(--border)');
    expect(text).toContain('var(--input)');
  });

  it('beats Tailwind preflight on specificity (* 0,0,0; ::before 0,0,1; input/select 0,0,1)', () => {
    const border = base!.children.find((rule) => rule.decls.has('border-color') && !rule.decls.has('background-color'))!;
    const field = base!.children.find((rule) => rule.decls.has('background-color'))!;
    for (const selector of splitSelectors(border.prelude)) {
      const floor: Specificity = selector.includes('::') ? [0, 0, 1] : [0, 0, 0];
      expect(compare(specificity(selector), floor), selector).toBeGreaterThan(0);
    }
    expect(splitSelectors(border.prelude).some((selector) => selector.endsWith('::before'))).toBe(true);
    expect(splitSelectors(border.prelude).some((selector) => selector.endsWith('::after'))).toBe(true);
    for (const selector of splitSelectors(field.prelude)) {
      expect(compare(specificity(selector), [0, 1, 1]), selector).toBeGreaterThanOrEqual(0);
    }
  });

  it('replaces the unlayered workspace field rule', () => {
    expect(workspaceCss).not.toMatch(/\.vf-workspace :is\(input/);
  });
});
