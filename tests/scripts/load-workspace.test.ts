import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkspaceFromPath } from '../../scripts/lib/load-workspace';
import { FIXTURES } from '@/content-engine/fixtures';
import { fixtureResolver } from '@/content-engine/fixtures';
import { validateWorkspace } from '@/content-engine/validate';
import { expectedInlineRanges, expectedWrapperRange, inlineRangeSource, wrapperRangeSource } from './workspace-range-fixtures';

describe('loadWorkspaceFromPath', () => {
  it('loads a directory with course.json and items/*.json and keeps sources', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    mkdirSync(join(dir, 'items'));
    writeFileSync(join(dir, 'course.json'), JSON.stringify(FIXTURES.minimal.manifest, null, 2));
    writeFileSync(join(dir, 'items', 'intro.json'), JSON.stringify(FIXTURES.minimal.items.intro, null, 2));
    const ws = loadWorkspaceFromPath(dir);
    expect((ws.manifest as { id: string }).id).toBe('minimal');
    expect(Object.keys(ws.items)).toEqual(['intro']);
    // Sources are keyed by refKey, so an item called "manifest" cannot displace the course document.
    expect(ws.sources?.course).toContain('"kind": "course"');
    expect(ws.sources?.['item:intro']).toContain('"kind": "lesson"');
  });
  it('keeps an item literally named "manifest" separate from the course document', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    mkdirSync(join(dir, 'items'));
    writeFileSync(join(dir, 'course.json'), JSON.stringify(FIXTURES.minimal.manifest, null, 2));
    writeFileSync(join(dir, 'items', 'manifest.json'), JSON.stringify({ ...FIXTURES.minimal.items.intro as object, id: 'manifest' }, null, 2));
    const ws = loadWorkspaceFromPath(dir);
    expect(Object.keys(ws.items)).toEqual(['manifest']);
    expect(ws.sources?.course).toContain('"kind": "course"');
    expect(ws.sources?.['item:manifest']).toContain('"kind": "lesson"');
  });
  it('rejects scalar and null directory items instead of passing them downstream', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    mkdirSync(join(dir, 'items'));
    writeFileSync(join(dir, 'course.json'), JSON.stringify(FIXTURES.minimal.manifest));
    writeFileSync(join(dir, 'items', 'scalar.json'), '7');
    writeFileSync(join(dir, 'items', 'null.json'), 'null');
    const ws = loadWorkspaceFromPath(dir);
    expect(ws.items).toEqual({});
    expect(ws.parseDiagnostics?.map((d) => `${d.code} ${d.docId}`).sort()).toEqual(['E_JSON_ROOT_NOT_OBJECT null', 'E_JSON_ROOT_NOT_OBJECT scalar']);
    expect((await validateWorkspace(ws, fixtureResolver)).errors.map((error) => error.code)).toEqual(['E_JSON_ROOT_NOT_OBJECT', 'E_JSON_ROOT_NOT_OBJECT']);
  });
  it('reports a duplicate item id across two files instead of letting the last one win', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    mkdirSync(join(dir, 'items'));
    writeFileSync(join(dir, 'course.json'), JSON.stringify(FIXTURES.minimal.manifest));
    writeFileSync(join(dir, 'items', 'a.json'), JSON.stringify({ ...FIXTURES.minimal.items.intro as object, id: 'intro' }));
    writeFileSync(join(dir, 'items', 'b.json'), JSON.stringify({ ...FIXTURES.minimal.items.intro as object, id: 'intro', title: 'Second' }));
    const ws = loadWorkspaceFromPath(dir);
    expect(ws.parseDiagnostics?.map((d) => d.code)).toContain('E_DUPLICATE_ITEM_DOCUMENT');
  });
  it('accepts a workspace envelope over one document limit but not an oversized document inside it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    const big = (bytes: number) => ({ schemaVersion: 1, kind: 'lesson', id: 'intro', title: 'x', blocks: [{ type: 'paragraph', content: [{ text: 'x'.repeat(bytes) }] }] });
    const large = join(dir, 'large.json');
    writeFileSync(large, JSON.stringify({ manifest: FIXTURES.minimal.manifest, items: { intro: big(700_000), second: { ...big(700_000), id: 'second' } } }));
    expect(loadWorkspaceFromPath(large).parseDiagnostics).toBeUndefined();

    const oversized = join(dir, 'oversized.json');
    writeFileSync(oversized, JSON.stringify({ manifest: FIXTURES.minimal.manifest, items: { intro: big(1_100_000) } }));
    expect(loadWorkspaceFromPath(oversized).parseDiagnostics?.map((d) => `${d.code} ${d.docId}`)).toEqual(['E_LIMIT_EXCEEDED intro']);
  });
  it('loads a single inline course file and a { manifest, items } file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    const inline = { ...(FIXTURES.minimal.manifest as object), modules: [{ id: 'm1', title: 'M', items: [{ type: 'lesson', id: 'intro', title: 'Welcome', blocks: [{ type: 'paragraph', content: [{ text: 'x' }] }] }] }] };
    writeFileSync(join(dir, 'course.json'), JSON.stringify(inline));
    const ws = loadWorkspaceFromPath(join(dir, 'course.json'));
    expect(Object.keys(ws.items)).toEqual(['intro']);
    writeFileSync(join(dir, 'ws.json'), JSON.stringify({ manifest: FIXTURES.minimal.manifest, items: FIXTURES.minimal.items }));
    expect(Object.keys(loadWorkspaceFromPath(join(dir, 'ws.json')).items)).toEqual(['intro']);
  });
  it('maps wrapper item diagnostics to their original source ranges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    const file = join(dir, 'wrapper.json');
    writeFileSync(file, wrapperRangeSource);
    const report = await validateWorkspace(loadWorkspaceFromPath(file), fixtureResolver);
    expect(report.errors.find((error) => error.docId === 'wrapper-item')).toMatchObject({
      code: 'E_SCHEMA',
      path: '/blocks',
      range: expectedWrapperRange,
    });
  });

  it('maps lesson, exam, and assignment diagnostics to their inline source ranges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ws-'));
    const file = join(dir, 'inline.json');
    writeFileSync(file, inlineRangeSource);
    const report = await validateWorkspace(loadWorkspaceFromPath(file), fixtureResolver);
    for (const [docId, range] of Object.entries(expectedInlineRanges)) {
      expect(report.errors.find((error) => error.code === 'E_DUPLICATE_ID' && error.docId === docId)).toMatchObject({ range });
    }
  });
});
