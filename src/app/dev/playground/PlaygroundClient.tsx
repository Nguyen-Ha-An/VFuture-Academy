'use client';

import { useState } from 'react';
import type { CompiledCourse } from '@/content-engine/compile';
import type { ValidationReport } from '@/content-engine/diagnostics';
import type { Locale } from '@/content-engine/schema/common';
import { registerAll, createPreviewRuntime, LessonRenderer, ExamPreviewRenderer, AssignmentRenderer } from '@/content-engine/render';
import { formatDiagnostic } from '@/content-engine/diagnostics';

registerAll();

type Data = Record<string, { ok: boolean; report: ValidationReport; compiled: CompiledCourse | null }>;

export function PlaygroundClient({ data }: { data: Data }) {
  const names = Object.keys(data);
  const [name, setName] = useState(names[0]);
  const [locale, setLocale] = useState<Locale>('vi');
  const course = data[name].compiled;
  const itemIds = course ? Object.keys(course.items) : [];
  const [itemId, setItemId] = useState(itemIds[0]);
  const item = course?.items[itemId] ?? course?.items[itemIds[0]];
  const [resetKey, setResetKey] = useState(0);
  const runtime = item ? createPreviewRuntime(item, item.renders[locale] ? locale : course!.defaultLanguage, course!.defaultLanguage) : null;
  if (!course || !item || !runtime) return <pre className="p-4 text-red-700">{data[name].report.errors.map((d) => formatDiagnostic(d, 'en')).join('\n')}</pre>;
  const render = item.renders[runtime.locale];
  return (
    <div className="grid min-h-screen grid-cols-[260px_1fr_320px] gap-4 p-4 font-sans">
      <aside className="space-y-3 text-sm">
        <select value={name} onChange={(e) => { setName(e.target.value); setItemId(Object.keys(data[e.target.value].compiled?.items ?? {})[0]); }} className="w-full rounded border p-1">{names.map((n) => <option key={n}>{n}</option>)}</select>
        <div className="flex gap-1">{(['vi', 'en'] as Locale[]).map((l) => <button key={l} onClick={() => setLocale(l)} className={`rounded border px-2 py-1 ${locale === l ? 'bg-neutral-900 text-white' : ''}`}>{l}</button>)}</div>
        <ul className="space-y-1">{course.outline.modules.map((m) => <li key={m.id}><p className="font-semibold">{typeof m.title === 'string' ? m.title : m.title[runtime.locale] ?? m.title.vi}</p><ul className="pl-3">{m.items.map((it) => <li key={it.id}><button onClick={() => setItemId(it.id)} className={`text-left ${it.id === item.id ? 'underline' : ''}`}>{it.type} · {it.id}</button></li>)}</ul></li>)}</ul>
        <button onClick={() => setResetKey((key) => key + 1)} className="rounded border px-2 py-1">Reset state</button>
      </aside>
      <main key={`${item.id}-${runtime.locale}-${resetKey}`}>{item.kind === 'lesson' ? <LessonRenderer item={render} runtime={runtime} /> : item.kind === 'exam' ? <ExamPreviewRenderer item={render} runtime={runtime} /> : <AssignmentRenderer assignment={render} target={{ blockId: null }} runtime={runtime} />}</main>
      <aside className="space-y-3 text-xs"><h2 className="font-semibold">Diagnostics ({data[name].report.warnings.length} warnings)</h2><ul className="space-y-1">{data[name].report.warnings.map((d, i) => <li key={i} className="text-amber-800">{formatDiagnostic(d, 'en')}</li>)}</ul><h2 className="font-semibold">Grading payload</h2><pre className="max-h-96 overflow-auto rounded bg-neutral-100 p-2">{JSON.stringify(item.grading, null, 1)}</pre></aside>
    </div>
  );
}
