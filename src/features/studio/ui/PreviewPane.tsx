"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CompiledCourse, CompiledItem, LearnerItem } from '@/content-engine/compile';
import { refKey, refLabel, type DocumentRef, type ValidationReport } from '@/content-engine/diagnostics';
import { AssignmentRenderer, createPreviewRuntime, ExamPreviewRenderer, LessonRenderer, registerAll } from '@/content-engine/render';
import type { Locale, MediaRef } from '@/content-engine/schema/common';
import { mediaHref } from '@/features/media/urls';
import { record, type WorkspaceSnapshot } from '../workspace-state';
import { readApiData, WorkspaceApiError, workspaceIssueReport } from './client';
import { measureStudioOperation, startStudioTiming } from './studio-performance';

registerAll();
export function previewMediaHref(ref: { assetId: string } | { url: string }): string {
  return 'assetId' in ref ? mediaHref(ref.assetId) : ref.url;
}
export type WorkspacePreview = { item: CompiledItem | null; course: CompiledCourse | null; report: ValidationReport };

function title(value: unknown, locale: Locale): string {
  return typeof value === 'string' ? value : String(record(value)?.[locale] ?? Object.values(record(value) ?? {})[0] ?? '');
}
export function PreviewPane({ courseId, selectedRef, payload, sourceRevision, validating = false, languages, defaultLanguage, onReport }: {
  courseId: string; selectedRef: DocumentRef; payload: WorkspaceSnapshot | null; sourceRevision: string;
  validating?: boolean;
  languages: Locale[]; defaultLanguage: Locale;
  /** The revision the report was computed for; the caller drops anything stale. */
  onReport: (report: ValidationReport, revision: string) => void;
}) {
  const selectedDocId = refLabel(selectedRef);
  const selectedKey = refKey(selectedRef);
  const t = useTranslations('studioWorkspace');
  const [chosenLocale, setLocale] = useState(defaultLanguage);
  const locale = languages.includes(chosenLocale) ? chosenLocale : defaultLanguage;
  const cache = useRef(new Map<string, { result: WorkspacePreview; revision: string }>());
  const previousKey = useRef<string | null>(null);
  const key = `${courseId}/${selectedKey}/${locale}`;
  const [display, setDisplay] = useState<{ key: string; result: WorkspacePreview; revision: string } | null>(null);
  const [requestState, setRequestState] = useState<{ key: string; revision: string; state: 'loading' | 'error' | 'ready' } | null>(null);
  const onReportRef = useRef(onReport);
  onReportRef.current = onReport;
  // Serialized once per payload and spliced into the request body verbatim: the
  // already-validated snapshot is never re-parsed on the way out.
  const serializedManifest = useMemo(() => measureStudioOperation(
    'studio.workspace.preview.prepare',
    () => payload ? JSON.stringify(payload.manifest) : null,
  ), [payload]);
  const serializedItems = useMemo(() => measureStudioOperation(
    'studio.workspace.preview.prepare',
    () => payload ? JSON.stringify(payload.items) : null,
  ), [payload]);
  const serializedPayload = serializedManifest === null || serializedItems === null ? null : `${serializedManifest}${serializedItems}`;

  useEffect(() => {
    const controller = new AbortController();
    const switchedDocument = previousKey.current !== null && previousKey.current !== key;
    previousKey.current = key;
    const cached = cache.current.get(key);
    setDisplay(cached ? { key, ...cached } : null);
    if (!serializedPayload) { setRequestState({ key, revision: sourceRevision, state: validating ? 'loading' : 'error' }); return () => controller.abort(); }
    if (cached?.revision === sourceRevision) {
      setRequestState({ key, revision: sourceRevision, state: 'ready' });
      return () => controller.abort();
    }
    setRequestState({ key, revision: sourceRevision, state: 'loading' });
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const finishRequestTiming = startStudioTiming('studio.workspace.preview.request');
          const result = await readApiData<WorkspacePreview>(await fetch(`/api/v1/studio/courses/${encodeURIComponent(courseId)}/draft/preview`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            // `selectedRef` is authoritative: an item legitimately named `manifest`
            // is indistinguishable from the course manifest in the legacy
            // `selectedDocId` string, which is kept only for compatibility.
            body: `{"manifest":${serializedManifest},"items":${serializedItems},"selectedRef":${JSON.stringify(selectedRef)},"selectedDocId":${JSON.stringify(selectedDocId)},"locale":${JSON.stringify(locale)}}`,
            signal: controller.signal,
          }).finally(finishRequestTiming));
          if (controller.signal.aborted) return;
          onReportRef.current(result.report, sourceRevision);
          if ((selectedRef.kind === 'course' && !result.course) || (selectedRef.kind === 'item' && !result.item)) {
            setRequestState({ key, revision: sourceRevision, state: 'error' }); return;
          }
          cache.current.set(key, { result, revision: sourceRevision });
          setDisplay({ key, result, revision: sourceRevision });
          setRequestState({ key, revision: sourceRevision, state: 'ready' });
        } catch (cause) {
          if (!controller.signal.aborted) {
            if (cause instanceof WorkspaceApiError && cause.issues?.length) onReportRef.current(workspaceIssueReport(cause.issues), sourceRevision);
            setRequestState({ key, revision: sourceRevision, state: 'error' });
          }
        }
      })();
    }, switchedDocument ? 0 : 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [courseId, key, locale, selectedDocId, selectedRef, serializedItems, serializedManifest, serializedPayload, sourceRevision, validating]);

  const visible = display?.key === key ? display : null;
  const item = visible?.result.item ?? null;
  const course = visible?.result.course ?? null;
  const stale = Boolean(visible && visible.revision !== sourceRevision);
  const failed = (!payload && !validating) || (requestState?.key === key && requestState.revision === sourceRevision && requestState.state === 'error');
  const runtime = useMemo(() => item ? { ...createPreviewRuntime(item, locale), resolveMedia: (ref: MediaRef) => previewMediaHref(ref) } : null, [item, locale]);
  const render = item?.renders[locale] as LearnerItem | undefined;

  return <section aria-label={t('preview')} className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex min-h-12 items-center justify-between gap-2 border-b border-border px-4">
      <h2 className="text-sm font-medium">{t('preview')}</h2>
      {languages.length > 1 ? <div role="group" aria-label={t('language')} className="flex gap-1">{languages.map(value => <button key={value} type="button" aria-pressed={locale === value} onClick={() => setLocale(value)} className="min-h-9 rounded px-3 text-xs uppercase hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-muted">{value}</button>)}</div> : null}
      {requestState?.state === 'loading' && !failed ? <span role="status" className="text-xs text-muted-foreground">{t('updating')}</span> : null}
    </header>
    {stale || (failed && visible) ? <p role="status" className="border-b border-border bg-amber-50 px-4 py-2 text-xs text-amber-900">{t('stalePreview')}</p> : null}
    {/* Light island: inside the staff shell the learner rendering keeps the app-default tokens and font (shell.css). */}
    <div className="vf-staff-preview-island min-h-0 flex-1 overflow-auto p-5">
      {!visible ? <p role="status" className="py-20 text-center text-sm text-muted-foreground">{t(failed ? 'previewInvalid' : 'updating')}</p> : null}
      {selectedRef.kind === 'course' && course ? <article className="mx-auto max-w-2xl space-y-6">
        <div><p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{t('courseOverview')}</p><h3 className="text-2xl font-semibold">{title(course.meta.title, locale)}</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{title(course.meta.summary, locale)}</p></div>
        <ul className="list-disc space-y-2 pl-5 text-sm">{course.meta.learningOutcomes.map((outcome, index) => <li key={index}>{title(outcome, locale)}</li>)}</ul>
        {course.outline.modules.map(module => <section key={module.id} className="border-t border-border pt-4"><h4 className="font-semibold">{title(module.title, locale)}</h4><ol className="mt-3 space-y-2">{module.items.map((entry, index) => <li key={entry.id} className="text-sm text-muted-foreground">{index + 1}. {title(entry.title, locale)}</li>)}</ol></section>)}
      </article> : null}
      {item && render && runtime ? <div key={`${key}-${item.checksum}`} lang={locale} className="mx-auto max-w-3xl">
        {item.kind === 'lesson' ? <LessonRenderer item={render} runtime={runtime} /> : null}
        {item.kind === 'exam' ? <ExamPreviewRenderer item={render} runtime={runtime} /> : null}
        {item.kind === 'assignment' ? <AssignmentRenderer assignment={render} runtime={runtime} /> : null}
      </div> : null}
    </div>
  </section>;
}
