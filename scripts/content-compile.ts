import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileCourse } from '../src/content-engine/compile';
import { formatDiagnostic } from '../src/content-engine/diagnostics';
import type { Locale } from '../src/content-engine/schema/common';
import { loadRefsResolver, loadWorkspaceFromPath } from './lib/load-workspace';

function parseLocales(value: string | undefined): Locale[] | undefined {
  if (value === undefined) return undefined;
  const locales = value.split(',');
  const invalid = locales.find((locale) => locale !== 'vi' && locale !== 'en');
  if (invalid !== undefined) throw new Error(`unsupported locale: ${invalid || '(empty)'}`);
  return locales as Locale[];
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string', default: 'compiled-out' }, locales: { type: 'string' }, refs: { type: 'string' }, fixtures: { type: 'boolean', default: false }, publish: { type: 'boolean', default: true }, force: { type: 'boolean', default: false } } });
  const target = positionals[0];
  if (!target) { console.error('usage: npm run content:compile -- <dir|file.json> [--out dir] [--locales vi,en] [--refs refs.json] [--fixtures] [--publish] [--force]'); process.exitCode = 2; return; }
  let locales: Locale[] | undefined;
  try { locales = parseLocales(values.locales); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 2; return; }
  const ws = loadWorkspaceFromPath(target);
  const r = await compileCourse(ws, loadRefsResolver({ refs: values.refs, fixtures: values.fixtures }), { publish: values.publish, locales });
  if (!r.ok || !r.compiled) { for (const d of r.diagnostics) console.error(formatDiagnostic(d, 'en')); process.exitCode = 1; return; }
  const out = values.out!;
  if (existsSync(out) && readdirSync(out).length && !values.force) { console.error(`output directory is not empty: ${out} (use --force to replace it)`); process.exitCode = 2; return; }
  const staging = `${out}.staging-${process.pid}-${Date.now()}`;
  const { items, ...course } = r.compiled;
  mkdirSync(join(staging, 'renders'), { recursive: true }); mkdirSync(join(staging, 'grading'), { recursive: true });
  writeFileSync(join(staging, 'course.json'), JSON.stringify(course, null, 2));
  for (const item of Object.values(items)) { for (const [loc, render] of Object.entries(item.renders)) writeFileSync(join(staging, 'renders', `${item.id}.${loc}.json`), JSON.stringify(render, null, 2)); writeFileSync(join(staging, 'grading', `${item.id}.json`), JSON.stringify(item.grading, null, 2)); }
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  renameSync(staging, out);
  console.log(`compiled ${Object.keys(items).length} items → ${values.out} (checksum ${r.compiled.checksum.slice(0, 12)}…)`);
}

void main();
