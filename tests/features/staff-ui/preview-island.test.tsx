// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { itemRef } from '@/content-engine/diagnostics';
import { PreviewPane, type WorkspacePreview } from '@/features/studio/ui/PreviewPane';
import en from '@/messages/en.json';

vi.mock('@/content-engine/render', () => ({
  registerAll: () => undefined,
  createPreviewRuntime: () => ({}),
  LessonRenderer: ({ item }: { item: { title: string } }) => <h3>{item.title}</h3>,
  ExamPreviewRenderer: () => null,
  AssignmentRenderer: () => null,
}));

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const globals = read('src/app/globals.css');
const shell = read('src/features/staff-ui/shell.css');
const tokens = read('src/features/staff-ui/staff-tokens.css');
const tailwindTheme = read('node_modules/tailwindcss/theme.css');

function declarations(block: string): Map<string, string> {
  return new Map([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}
/** The rule whose selector list starts with `selector` (up to its closing brace). */
function block(css: string, selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[,{]`, 'm'));
  if (start < 0) throw new Error(`No rule for ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

const island = block(shell, '.vf-staff .vf-staff-preview-island');
const islandTokens = declarations(island);
/** Every custom property the app declares on :root in globals.css (the learner/app defaults). */
const appDefaults = new Map([...globals.matchAll(/^:root \{([\s\S]*?)^\}/gm)].flatMap(([, body]) => [...declarations(body)]));

describe('preview light island tokens (shell.css)', () => {
  it('re-declares every app-default :root token from globals.css with the same value', () => {
    expect(appDefaults.size).toBeGreaterThan(40);
    for (const [name, value] of appDefaults) {
      expect(islandTokens.get(name), name).toBe(value);
    }
  });

  it('covers every token the staff theme overrides, so none leaks into the preview', () => {
    const staffLight = declarations(block(tokens, ':root:has(.vf-staff)'));
    const tailwindRadius = declarations(tailwindTheme);
    for (const name of staffLight.keys()) {
      if (name === '--destructive-soft-foreground') expect(islandTokens.get(name)).toBe('initial');
      else if (/^--radius-(sm|lg|xl)$/.test(name)) expect(islandTokens.get(name), name).toBe(tailwindRadius.get(name));
      else if (name === '--radius-md') expect(islandTokens.get(name)).toBe(appDefaults.get('--radius'));
      else expect(islandTokens.has(name), name).toBe(true);
    }
  });

  it('covers only the preview pane; CodeMirror editors take the staff theme instead', () => {
    expect(island.slice(0, island.indexOf('{'))).toMatch(/^\.vf-staff \.vf-staff-preview-island\s*$/);
    expect(shell).toMatch(/^:root:has\(\.vf-staff\) \.vf-staff \.cm-editor:not\(\.vf-staff-preview-island \*\) \{[^}]*background-color: var\(--background\);[^}]*color: var\(--foreground\);/m);
  });

  it('pins the light color scheme, the app surface colours and Be Vietnam Pro', () => {
    expect(islandTokens.get('--app-font-sans')).toBe('"Be Vietnam Pro", sans-serif');
    expect(island).toMatch(/color-scheme:\s*light;/);
    expect(island).toMatch(/font-family:\s*var\(--app-font-sans\);/);
    expect(island).toMatch(/background-color:\s*var\(--background\);/);
    expect(island).toMatch(/color:\s*var\(--foreground\);/);
  });

  it('resets every class the staff dark bridge repaints, and only inside the staff shell', () => {
    const bridged = new Set([...tokens.matchAll(/:root:has\(\.vf-staff\[data-theme="dark"\]\) ([^{]+)\{/g)]
      .flatMap(([, selector]) => [...selector.matchAll(/\.((?:hover\\:)?[a-z]+-[a-z]+-\d+(?:\\\/\d+)?)/g)].map(([, name]) => name)));
    expect(bridged.size).toBeGreaterThan(20);
    const resets = shell.slice(shell.indexOf(':root:has(.vf-staff) body .vf-staff-preview-island'));
    for (const name of bridged) expect(resets, name).toContain(`.${name}`);
    for (const rule of shell.matchAll(/^([^\s@}{][^{]*)\{/gm)) {
      if (rule[1].includes('preview-island')) expect(rule[1]).toMatch(/^(\.vf-staff |:root:has\(\.vf-staff\) )/);
    }
  });
});

describe('PreviewPane light island', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('renders the learner preview inside the island and keeps the pane chrome outside it', async () => {
    vi.useFakeTimers();
    const result: WorkspacePreview = {
      report: { ok: true, errors: [], warnings: [], summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 0 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['en'] } } as WorkspacePreview['report'],
      course: null,
      item: { id: 'one', kind: 'lesson', checksum: 'c', renders: { en: { id: 'one', kind: 'lesson', title: 'Bài học đầu tiên' } }, grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [] } } as unknown as WorkspacePreview['item'],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: result }), { status: 200 })));
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PreviewPane courseId="course" selectedRef={itemRef('one')} payload={{ manifest: { id: 'course' }, items: {} } as never} sourceRevision="1" languages={['en']} defaultLanguage="en" onReport={() => undefined} />
      </NextIntlClientProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(400));

    const lesson = screen.getByRole('heading', { name: 'Bài học đầu tiên' });
    expect(lesson.closest('.vf-staff-preview-island')).not.toBeNull();
    expect(screen.getByRole('heading', { name: en.studioWorkspace.preview }).closest('.vf-staff-preview-island')).toBeNull();
  });
});
