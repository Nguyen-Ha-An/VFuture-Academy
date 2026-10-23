import { parseArgs } from 'node:util';
import { validateWorkspace } from '../src/content-engine/validate';
import { formatDiagnostic } from '../src/content-engine/diagnostics';
import { loadRefsResolver, loadWorkspaceFromPath } from './lib/load-workspace';

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { publish: { type: 'boolean', default: false }, lang: { type: 'string', default: 'en' }, json: { type: 'boolean', default: false }, refs: { type: 'string' }, fixtures: { type: 'boolean', default: false } } });
  const target = positionals[0];
  if (!target) { console.error('usage: npm run content:validate -- <dir|file.json> [--publish] [--lang vi|en] [--json] [--refs refs.json] [--fixtures]'); process.exitCode = 2; return; }
  if (values.lang !== 'vi' && values.lang !== 'en') { console.error(`unsupported locale: ${values.lang}`); process.exitCode = 2; return; }
  const locale = values.lang;
  const ws = loadWorkspaceFromPath(target);
  const report = await validateWorkspace(ws, loadRefsResolver({ refs: values.refs, fixtures: values.fixtures }), { publish: values.publish });
  if (values.json) console.log(JSON.stringify(report, null, 2));
  else {
    for (const d of [...report.errors, ...report.warnings]) console.log(`${formatDiagnostic(d, locale)}${d.range ? ` (line ${d.range.start.line}:${d.range.start.col})` : ''}`);
    const s = report.summary;
    console.log(`\n${report.ok ? 'OK' : 'FAILED'} — ${report.errors.length} errors, ${report.warnings.length} warnings · ${s.modules} modules · ${s.items.lesson} lessons, ${s.items.exam} exams, ${s.items.assignment} assignments · ${Object.values(s.questions).reduce((a, b) => a + b, 0)} questions · ${s.totalPoints} points · ${s.languages.join('/')}`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

void main();
