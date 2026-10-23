import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import en from '@/messages/en.json';
import { mergeCatalogTrees, staffUiCatalogs, staffUiMessages, staffUiTestMessages, withStaffUiMessages } from '@/messages/staff-ui';

const DIR = path.join(process.cwd(), 'src/messages/staff-ui');
const AREAS = ['kit', 'insights', 'shell', 'admin', 'studio', 'grading'] as const;

type Tree = { [key: string]: Tree | string };

/** Flattens a message tree to sorted dotted paths, marking branches so a leaf/branch swap also fails. */
function keyPaths(tree: unknown, prefix = ''): string[] {
  if (typeof tree !== 'object' || tree === null || Array.isArray(tree)) return [prefix];
  const entries = Object.entries(tree as Tree);
  if (entries.length === 0) return prefix ? [`${prefix}{}`] : [];
  return entries.flatMap(([key, value]) => keyPaths(value, prefix ? `${prefix}.${key}` : key)).sort();
}

function leafValues(tree: unknown): unknown[] {
  if (typeof tree !== 'object' || tree === null || Array.isArray(tree)) return [tree];
  return Object.values(tree).flatMap(leafValues);
}

describe('staff-ui message catalogs', () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith('.json')).sort();

  it('ships only area files and registered <area>-<part> files', () => {
    const registered = Object.values(staffUiCatalogs).flat().length;
    for (const area of AREAS) expect(files).toContain(`${area}.json`);
    for (const file of files) expect(AREAS.some((area) => file === `${area}.json` || file.startsWith(`${area}-`))).toBe(true);
    expect(files).toHaveLength(registered);
  });

  it('merges part files without letting two files define the same key', () => {
    for (const locale of ['vi', 'en'] as const) expect(() => staffUiMessages(locale)).not.toThrow();
    expect(() => mergeCatalogTrees([{ a: { b: 'x' } }, { a: { b: 'y' } }])).toThrow(/a\.b/);
    expect(mergeCatalogTrees([{ a: { b: 'x' } }, { a: { c: 'y' } }])).toEqual({ a: { b: 'x', c: 'y' } });
  });

  it.each(files)('%s has identical vi and en key trees with non-empty strings', (file) => {
    const catalog = JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(catalog).sort()).toEqual(['en', 'vi']);
    expect(keyPaths(catalog.vi)).toEqual(keyPaths(catalog.en));
    for (const locale of ['vi', 'en'] as const) {
      for (const value of leafValues(catalog[locale])) expect(typeof value === 'string' && value.trim().length > 0).toBe(true);
    }
  });

  it('merges every area under staffUi without dropping existing namespaces', () => {
    const base = { common: { save: 'Save' } };
    const merged = withStaffUiMessages(base, 'vi');
    expect(Object.keys(merged.staffUi).sort()).toEqual([...AREAS].sort());
    expect(merged.common).toBe(base.common);
    expect(merged.staffUi).toEqual(staffUiMessages('vi'));
  });

  it('gives tests the production composition (bench + staffUi) on top of a locale file', () => {
    const messages = staffUiTestMessages(en, 'en');
    expect(messages).toHaveProperty('bench');
    expect(Object.keys(messages.staffUi).sort()).toEqual([...AREAS].sort());
    expect(Object.keys(messages)).toEqual(expect.arrayContaining(Object.keys(en)));
  });
});
