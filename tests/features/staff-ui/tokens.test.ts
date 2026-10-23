import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import tailwind from '@tailwindcss/postcss';
import postcss from 'postcss';
import { afterAll, describe, expect, it } from 'vitest';

const TOKENS_FILE = path.join(process.cwd(), 'src/features/staff-ui/staff-tokens.css');
const GLOBALS_FILE = path.join(process.cwd(), 'src/app/globals.css');
const tokensCss = readFileSync(TOKENS_FILE, 'utf8');
const globalsCss = readFileSync(GLOBALS_FILE, 'utf8');

const LIGHT = ':root:has(.vf-staff)';
const DARK_MEDIA = '@media (prefers-color-scheme: dark)';
const DARK_OS = ':root:has(.vf-staff:not([data-theme="light"]))';
const DARK_PINNED = ':root:has(.vf-staff[data-theme="dark"])';
const ALLOWED_AT_RULES = new Set([DARK_MEDIA, '@media (prefers-reduced-motion: reduce)']);

type Block = { prelude: string; decls: Map<string, string>; children: Block[] };

/** Minimal brace parser: enough for a flat token file (no strings containing braces). */
function parse(css: string): Block[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let index = 0;
  function readBlock(prelude: string): Block {
    const block: Block = { prelude, decls: new Map(), children: [] };
    let buffer = '';
    while (index < source.length) {
      const char = source[index++];
      if (char === '{') {
        block.children.push(readBlock(buffer.trim()));
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
    if (char === '(') depth++;
    if (char === ')') depth--;
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

const tree = parse(tokensCss);
const topRule = (prelude: string) => tree.find((block) => block.prelude === prelude);
const mediaRule = (media: string, prelude: string) =>
  tree.filter((block) => block.prelude === media).flatMap((block) => block.children).find((block) => block.prelude === prelude);

const light = topRule(LIGHT)!.decls;
const darkOs = mediaRule(DARK_MEDIA, DARK_OS)!.decls;
const darkPinned = topRule(DARK_PINNED)!.decls;

function hsl(value: string | undefined): [number, number, number] {
  const match = value?.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/);
  if (!match) throw new Error(`expected an hsl() colour, got ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function toSrgb([h, s, l]: [number, number, number]): [number, number, number] {
  const sat = s / 100;
  const lightness = l / 100;
  const a = sat * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

function luminance([red, green, blue]: [number, number, number]): number {
  const [r, g, b] = [red, green, blue].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function contrast(a: string | undefined, b: string | undefined): number {
  return ratio(toSrgb(hsl(a)), toSrgb(hsl(b)));
}

/** A `bg-<tint>/<alpha>` utility composited over its surface, as the browser paints it (sRGB). */
function blend(tint: string | undefined, alpha: number, surface: string | undefined): [number, number, number] {
  const [top, base] = [toSrgb(hsl(tint)), toSrgb(hsl(surface))];
  return [0, 1, 2].map((i) => top[i] * alpha + base[i] * (1 - alpha)) as [number, number, number];
}

const AA_PAIRS: Array<[string, string]> = [
  ['--foreground', '--background'],
  ['--card-foreground', '--card'],
  ['--popover-foreground', '--popover'],
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--muted'],
  ['--primary-foreground', '--primary'],
  ['--secondary-foreground', '--secondary'],
  ['--accent-foreground', '--accent'],
  ['--destructive', '--background'],
  ['--destructive', '--popover'],
  ['--destructive-foreground', '--destructive'],
  ['--sidebar-foreground', '--sidebar'],
  ['--muted-foreground', '--sidebar'],
  ['--sidebar-primary-foreground', '--sidebar-primary'],
  ['--sidebar-accent-foreground', '--sidebar-accent'],
  ['--success-foreground', '--success'],
  ['--warning-foreground', '--warning'],
  ['--info-foreground', '--info'],
];

// Text on an opacity tint: [text, tint, alpha, surface the tint sits on].
const TINTED_AA_PAIRS: Array<[string, string, number, string]> = [
  // Badge danger, StatusNotice error, PipelineStrip danger.
  ['--destructive-soft-foreground', '--destructive', 0.1, '--card'],
  // Destructive DropdownMenuItem while focused.
  ['--destructive-soft-foreground', '--destructive', 0.1, '--popover'],
];

describe('staff tokens', () => {
  it('declares both dark blocks with identical properties and values', () => {
    expect(darkOs.size).toBeGreaterThan(0);
    expect([...darkPinned.entries()].sort()).toEqual([...darkOs.entries()].sort());
    expect(darkOs.get('color-scheme')).toBe('dark');
    expect(light.get('color-scheme')).toBe('light');
  });

  it('gives every light colour token a dark value', () => {
    const themeInvariant = /^--(radius|app-font-sans|font-mono|brand)/;
    const colourTokens = [...light.keys()].filter((key) => key.startsWith('--') && !themeInvariant.test(key));
    expect(colourTokens.filter((key) => !darkOs.has(key))).toEqual([]);
  });

  it('keeps the temporary dark bridge identical under both dark selectors', () => {
    const media = tree.filter((block) => block.prelude === DARK_MEDIA).flatMap((block) => block.children);
    const bridge = (rules: Block[], prefix: string) =>
      rules
        .filter((rule) => rule.prelude.startsWith(`${prefix} `))
        .map((rule) => `${rule.prelude.slice(prefix.length)} ${[...rule.decls.entries()].join(';')}`)
        .sort();
    const osBridge = bridge(media, DARK_OS);
    expect(osBridge.length).toBeGreaterThan(0);
    expect(bridge(tree, DARK_PINNED)).toEqual(osBridge);
  });

  it('scopes every selector to documents that render the staff shell', () => {
    function check(blocks: Block[], insideAtRule: boolean) {
      for (const block of blocks) {
        if (block.prelude.startsWith('@')) {
          expect(insideAtRule, `nested at-rule ${block.prelude}`).toBe(false);
          expect(ALLOWED_AT_RULES.has(block.prelude), block.prelude).toBe(true);
          check(block.children, true);
          continue;
        }
        expect(block.children, block.prelude).toEqual([]);
        for (const selector of splitSelectors(block.prelude)) {
          expect(selector.startsWith(':root:has(.vf-staff'), selector).toBe(true);
        }
      }
    }
    check(tree, false);
  });

  it('sets the staff radius scale, Inter stack and body colours', () => {
    expect(light.get('--radius')).toBe('0.5rem');
    expect(['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl'].map((key) => light.get(key))).toEqual(['4px', '6px', '8px', '12px']);
    expect(light.get('--app-font-sans')).toBe('"Inter", "Be Vietnam Pro", system-ui, sans-serif');
    expect(topRule(`${LIGHT} body`)?.decls.get('background')).toBe('var(--background)');
  });

  it('turns off transitions and animations under reduced motion', () => {
    const reduced = tree.find((block) => block.prelude === '@media (prefers-reduced-motion: reduce)');
    expect(reduced?.children[0]?.decls.get('transition')).toBe('none !important');
    expect(reduced?.children[0]?.decls.get('animation')).toBe('none !important');
  });

  it.each([
    ['light', light],
    ['dark', darkOs],
  ] as const)('meets WCAG AA (4.5:1) for every text pair in %s', (_theme, tokens) => {
    const failures = AA_PAIRS.map(([fg, bg]) => ({ pair: `${fg} on ${bg}`, ratio: contrast(tokens.get(fg), tokens.get(bg)) }))
      .filter(({ ratio }) => ratio < 4.5)
      .map(({ pair, ratio }) => `${pair}: ${ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it.each([
    ['light', light],
    ['dark', darkOs],
  ] as const)('meets WCAG AA (4.5:1) for text on opacity tints in %s', (_theme, tokens) => {
    const failures = TINTED_AA_PAIRS.map(([fg, tint, alpha, surface]) => ({
      pair: `${fg} on ${tint}/${alpha * 100} over ${surface}`,
      ratio: ratio(toSrgb(hsl(tokens.get(fg))), blend(tokens.get(tint), alpha, tokens.get(surface))),
    }))
      .filter(({ ratio: value }) => value < 4.5)
      .map(({ pair, ratio: value }) => `${pair}: ${value.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it('keeps grayscale charts and a zinc (never blue) sidebar accent in both themes', () => {
    for (const tokens of [light, darkOs]) {
      for (const key of ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--sidebar-primary', '--sidebar-ring']) {
        const [hue, saturation] = hsl(tokens.get(key));
        expect(saturation <= 10 && (hue === 0 || hue === 240), `${key} ${tokens.get(key)}`).toBe(true);
      }
    }
  });
});

describe('globals.css staff hooks', () => {
  const tempBase = mkdtempSync(path.join(tmpdir(), 'vf-tokens-'));
  afterAll(() => rmSync(tempBase, { recursive: true, force: true }));

  async function compileWith(candidates: string[]) {
    const input = `${globalsCss}\n@source inline("${candidates.join(' ')}");\n`;
    const result = await postcss([tailwind({ base: tempBase })]).process(input, { from: GLOBALS_FILE });
    return result.css;
  }

  it('keeps Be Vietnam Pro as the app default through --app-font-sans', () => {
    const root = parse(globalsCss).find((block) => block.prelude === ':root' && block.decls.has('--app-font-sans'));
    expect(root?.decls.get('--app-font-sans')).toBe('"Be Vietnam Pro", sans-serif');
    expect(globalsCss).toContain('--font-sans: var(--app-font-sans)');
    expect(parse(globalsCss).find((block) => block.prelude === 'body')?.decls.get('font-family')).toBe('var(--app-font-sans)');
  });

  it('defines the staff-scoped dark custom variant', () => {
    expect(globalsCss).toMatch(/@custom-variant dark \{/);
    expect(globalsCss).toContain('&:where(:root:has(.vf-staff:not([data-theme="light"])) *) { @slot; }');
    expect(globalsCss).toContain('&:where(:root:has(.vf-staff[data-theme="dark"]) *) { @slot; }');
  });

  it('compiles dark: only under the staff scope and keeps app radii and fonts', async () => {
    const css = await compileWith(['dark:bg-card', 'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'font-sans', 'bg-sidebar', 'text-chart-1', 'bg-info', 'text-destructive-foreground', 'text-destructive-soft-foreground', 'bg-brand']);
    const darkRules = css.match(/\.dark\\:bg-card[^{]*\{/g) ?? [];
    expect(darkRules).toEqual([
      '.dark\\:bg-card:where(:root:has(.vf-staff:not([data-theme="light"])) *) {',
      '.dark\\:bg-card:where(:root:has(.vf-staff[data-theme="dark"]) *) {',
    ]);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*\.dark\\:bg-card:where\(:root:has\(\.vf-staff:not/);
    expect(css).toContain('--radius-sm: 0.25rem;');
    expect(css).toContain('--radius-md: var(--radius);');
    expect(css).toContain('--radius-lg: 0.5rem;');
    expect(css).toContain('--radius-xl: 0.75rem;');
    expect(css).toMatch(/\.rounded-md \{\s*border-radius: var\(--radius-md\);/);
    expect(css).toMatch(/\.font-sans \{\s*font-family: var\(--app-font-sans\);/);
    for (const utility of ['bg-sidebar', 'text-chart-1', 'bg-info', 'text-destructive-foreground', 'bg-brand']) {
      expect(css, utility).toMatch(new RegExp(`\\.${utility} \\{`));
    }
    // Staff-only token: outside the shell it falls back to --destructive read on the element.
    expect(css).toMatch(/\.text-destructive-soft-foreground \{\s*color: var\(--destructive-soft-foreground, var\(--destructive\)\);/);
  });

  it('defines an app default for every variable the new mappings read', () => {
    const rootDecls = parse(globalsCss)
      .filter((block) => block.prelude === ':root')
      .flatMap((block) => [...block.decls.keys()]);
    const mapped = [...globalsCss.matchAll(/--color-[\w-]+: var\((--[\w-]+)\)/g)].map((match) => match[1]);
    expect(mapped.filter((name) => !rootDecls.includes(name))).toEqual([]);
  });
});
