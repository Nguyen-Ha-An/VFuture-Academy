"use client";
import { StudioNotebookEntry } from '@/features/notebooks/ui/StudioNotebookEntry';

import Link from 'next/link';
import { ArrowLeft, ClipboardCheck, Download, Ellipsis, FilePlus2, ListTree, Save } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ContentWorkflowPanel, type BeforeSubmitResult, type ContentWorkflow } from '@/features/content-review/ContentWorkflowPanel';
import { contentStage } from '@/features/content-review/lifecycle';
import { ReadinessCard, type ReadinessItem } from '@/features/staff-ui/components/ReadinessCard';
import { StatusBadge } from '@/features/staff-ui/components/StatusBadge';
import { isStatusValue } from '@/features/staff-ui/components/status-tones';
import {
  COURSE_REF, emptySummary, itemRef, makeDiagnostic, refKey, refLabel, refOf,
  type Diagnostic, type DocumentRef, type Range, type ValidationReport,
} from '@/content-engine/diagnostics';
import { inlineWorkspace, parseWorkspace, parseJsonDocument, pointerToRange } from '@/content-engine/validate';
import { sourcesRevision } from '@/content-engine/validate/revision';
import type { Locale } from '@/content-engine/schema/common';
import { routes } from '@/lib/routes';
import { useStaffTitleRegistration } from '@/features/workspace/ui/StaffTitleContext';
import { cn } from '@/lib/utils';
import { evaluatePublishReadiness, type PublishCheckResult } from '../publish-checklist';
import { toRecoveryExport } from '../recovery';
import { record, workspaceIsDirty, type WorkspaceDraft, type WorkspaceSnapshot } from '../workspace-state';
import { useWorkspaceDraft } from './useWorkspaceDraft';
import { useLocalRecovery } from './useLocalRecovery';
import { useUnsavedChanges } from './useUnsavedChanges';
import { Outline } from './Outline';
import { JsonEditor } from './JsonEditor';
import { PreviewPane } from './PreviewPane';
import { ImportDialog } from './ImportDialog';
import { RecoveryBanner } from './RecoveryBanner';
import { VersionsDrawer } from './VersionsDrawer';
import { readApiData, workspaceIssueReport } from './client';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { STAGE_TONES } from './home/stages';

export type { WorkspaceDraft } from '../workspace-state';

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function localSaveText(locale: Locale, key: 'reconciling' | 'error' | 'check'): string {
  if (locale === 'vi') return key === 'reconciling' ? 'Đang kiểm tra bản lưu…' : key === 'check' ? 'Kiểm tra bản đã lưu' : 'Chưa lưu được. Thay đổi vẫn được giữ lại.';
  return key === 'reconciling' ? 'Checking saved version…' : key === 'check' ? 'Check saved version' : 'Not saved. Your changes are retained.';
}

function savedTime(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(value);
}

export function Workspace({ initialDraft, initialReport, readOnly = false, canCreate = false, accountId = 'unknown', scopeKey = 'central', recoveryStorage, recoveryClaim, recoveryDebounceMs, workflowEnabled = true }: {
  initialDraft: WorkspaceDraft; initialReport: ValidationReport; readOnly?: boolean; canCreate?: boolean;
  /** Recovery records are keyed by account and permission scope; both come from the server page. */
  accountId?: string; scopeKey?: string;
  /** Injection points for tests; production uses IndexedDB and the real tab handshake. */
  recoveryStorage?: Parameters<typeof useLocalRecovery>[0]['storage'];
  recoveryClaim?: Parameters<typeof useLocalRecovery>[0]['claim'];
  recoveryDebounceMs?: Parameters<typeof useLocalRecovery>[0]['debounceMs'];
  /** Test seams may disable the independently tested workflow client. */
  workflowEnabled?: boolean;
}) {
  const t = useTranslations('studioWorkspace');
  const header = useTranslations('staffUi.studio.courses');
  const locale = useLocale() as Locale;
  const [workflowLocked, setWorkflowLocked] = useState(!readOnly && workflowEnabled);
  const [acknowledged, setAcknowledged] = useState<Record<string, string> | null>(null);
  const workspace = useWorkspaceDraft(initialDraft, readOnly || workflowLocked, {
    onSaved: sources => setAcknowledged(sources),
  });
  const { state, save } = workspace;
  const guard = useUnsavedChanges(workspace.dirty, workspace.flush);
  const recovery = useLocalRecovery({
    accountId, scopeKey, courseId: initialDraft.courseId,
    sources: state.sources, baseUpdatedAt: state.updatedAt, baseVersionId: state.baseVersionId,
    dirty: workspace.dirty, readOnly, storage: recoveryStorage, claim: recoveryClaim, debounceMs: recoveryDebounceMs,
  });
  const [selectedRef, setSelectedRef] = useState<DocumentRef>(COURSE_REF);
  const [tab, setTab] = useState<'json' | 'preview'>('json');
  const [treeOpen, setTreeOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [readinessOpen, setReadinessOpen] = useState(false);
  const [workflow, setWorkflow] = useState<ContentWorkflow | null>(null);
  const [focusRange, setFocusRange] = useState<Range>();
  /**
   * A server report is only ever about the exact text it was computed from. It is
   * therefore stored with that revision and dropped the moment the text changes:
   * a later preview that fails must not leave the previous run's diagnostics on
   * screen looking current. The last good *preview* is a separate thing and stays
   * visible under a stale label.
   */
  const [report, setReport] = useState<{ value: ValidationReport; revision: string | null }>({ value: initialReport, revision: null });
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [versionsRevision, setVersionsRevision] = useState(0);
  const [reloading, setReloading] = useState(false);
  const selectedKey = refKey(selectedRef);
  const source = state.sources[selectedKey] ?? '';
  const sourceRevision = useMemo(() => sourcesRevision(state.sources), [state.sources]);
  const serverReport = report.revision === sourceRevision ? report.value : null;
  const revisionRef = useRef(sourceRevision);
  revisionRef.current = sourceRevision;
  const languages = useMemo(() => {
    const values = record(state.manifest)?.languages;
    return Array.isArray(values) ? [...new Set(values.filter((value): value is Locale => value === 'vi' || value === 'en'))] : [locale];
  }, [state.manifest, locale]);
  const defaultLanguage = (record(state.manifest)?.defaultLanguage === 'en' ? 'en' : 'vi') as Locale;
  const titleValue = record(state.manifest)?.title;
  const title = typeof titleValue === 'string' ? titleValue : String(record(titleValue)?.[locale] ?? record(titleValue)?.[defaultLanguage] ?? state.courseId);
  // The staff top bar's last crumb (Courses › course title) names the course, never its id.
  const registerStaffTitle = useStaffTitleRegistration();
  useEffect(() => registerStaffTitle(title), [registerStaffTitle, title]);
  const editingBlocked = readOnly || workflowLocked || reloading;
  const savePending = workspace.status === 'saving' || workspace.status === 'reconciling';
  const itemIds = useMemo(() => Object.keys(state.sources).filter(key => key !== refKey(COURSE_REF)).map(key => key.slice('item:'.length)), [state.sources]);
  const selectedIsMissing = selectedRef.kind === 'item' && !Object.hasOwn(state.sources, selectedKey);

  // The acknowledged raw sources clear this tab's recovery record — but only if the
  // record still holds exactly that text, so anything typed during the save stays.
  useEffect(() => {
    if (!acknowledged) return;
    setAcknowledged(null);
    void recovery.acknowledge(acknowledged);
  }, [acknowledged, recovery]);

  const displayReport = useMemo<ValidationReport>(() => {
    const server = workspaceIssueReport(workspace.issues);
    // Server warnings stay warnings; only errors block a save.
    const all = [...workspace.diagnostics, ...server.errors, ...server.warnings];
    if (!workspace.payload && !workspace.analysisPending && !all.length) all.push({ ...makeDiagnostic('E_SCHEMA', { ref: COURSE_REF, path: '' }), message: { vi: t('invalidSource'), en: t('invalidSource') } });
    const errorRefs = new Set(all.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic => refKey(refOf(diagnostic))));
    const seen = new Set<string>();
    const merged = [...all, ...(serverReport?.errors ?? []).filter(diagnostic => !errorRefs.has(refKey(refOf(diagnostic))))].filter(diagnostic => {
      const key = `${refKey(refOf(diagnostic))}-${diagnostic.code}-${diagnostic.path}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    const errors = merged.filter(diagnostic => diagnostic.severity === 'error');
    const warnings = [...merged.filter(diagnostic => diagnostic.severity !== 'error'), ...(serverReport?.warnings ?? [])];
    return { ok: errors.length === 0, errors, warnings, summary: serverReport?.summary ?? emptySummary(), revision: sourceRevision };
  }, [serverReport, sourceRevision, t, workspace.analysisPending, workspace.diagnostics, workspace.issues, workspace.payload]);
  // Readiness only passes on a server report for exactly the text on screen, with local analysis
  // settled; anything older leaves the automatic checks unverified.
  const readiness = useMemo(
    () => evaluatePublishReadiness(serverReport && !workspace.analysisPending ? displayReport : null, sourceRevision),
    [displayReport, serverReport, sourceRevision, workspace.analysisPending],
  );
  const workflowStatus = workflow?.content.status;
  const stage = workflow && workflowStatus && isStatusValue('content', workflowStatus)
    ? contentStage({ reviewStatus: workflow.activeReview?.status && isStatusValue('review', workflow.activeReview.status) ? workflow.activeReview.status : null, contentStatus: workflowStatus })
    : null;

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); if (!editingBlocked) void save();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [editingBlocked, save]);

  const select = (ref: DocumentRef, range?: Range) => {
    setSelectedRef(ref); setFocusRange(range); setTreeOpen(false);
  };
  const openDiagnostic = (diagnostic: Diagnostic, range = diagnostic.range) => {
    const ref = refOf(diagnostic);
    select(ref, range ?? pointerToRange(parseJsonDocument(state.sources[refKey(ref)] ?? '', ref), diagnostic.path));
    setTab('json');
  };
  const apply = (snapshot: WorkspaceSnapshot) => {
    if (!workspace.replace(snapshot)) return;
    setSelectedRef(COURSE_REF); setMenuOpen(false);
    setReport({ value: { ok: true, errors: [], warnings: [], summary: emptySummary() }, revision: null });
  };
  const applyItem = (document: unknown, moduleId: string) => {
    if (!workspace.importItem(document, moduleId)) return;
    setMenuOpen(false);
    const id = record(document)?.id;
    if (typeof id === 'string') setSelectedRef(itemRef(id));
  };
  const applySources = (sources: Record<string, string>) => {
    if (!workspace.restoreSources(sources)) return;
    setSelectedRef(COURSE_REF); setMenuOpen(false);
    setReport({ value: { ok: true, errors: [], warnings: [], summary: emptySummary() }, revision: null });
  };
  const validateForReview = async (): Promise<{ report: ValidationReport } | { error: string }> => {
    if (workspaceIsDirty(workspace.current.current)) return { error: t('saveBeforePublish') };
    setActionError(null);
    try {
      const next = await readApiData<ValidationReport>(await fetch(`/api/v1/studio/courses/${encodeURIComponent(state.courseId)}/draft/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publish: true }) }));
      // Review only starts from a clean draft, so the report belongs to exactly
      // the text on screen at this moment.
      const revision = sourcesRevision(workspace.current.current.sources);
      setReport({ value: next, revision }); return { report: next };
    } catch { return { error: t('validationFailed') }; }
  };
  // The workflow panel shows the returned message, so a failed check names its real cause
  // (unsaved text, a failed validation request, or the blocking errors) instead of "save first".
  const prepareForReview = async (): Promise<BeforeSubmitResult> => {
    if (!(await workspace.flush())) return false;
    const next = await validateForReview();
    if ('error' in next) return { ok: false, message: next.error };
    if (next.report.ok && next.report.errors.length === 0) return true;
    const count = next.report.errors.length;
    const first = next.report.errors.slice(0, 3).map(diagnostic => `${refLabel(refOf(diagnostic))}: ${diagnostic.message[locale]}`);
    return { ok: false, message: [header('readiness.blocked', { count }), ...first].join('\n') };
  };
  const rawSourceEnvelope = () => toRecoveryExport({
    accountId, scopeKey, courseId: state.courseId, tabId: recovery.scope?.tabId ?? 'current',
    version: 1, key: '', sources: state.sources, baseUpdatedAt: state.updatedAt,
    baseVersionId: state.baseVersionId, modifiedAt: Date.now(),
  });
  const exportCurrent = () => {
    const parsed = workspace.payload ? parseWorkspace(workspace.payload) : null;
    if (parsed?.ok && parsed.parsed) downloadJson(`${state.courseId}-draft.json`, inlineWorkspace(parsed.parsed));
    else downloadJson(`${state.courseId}-unsaved-sources.json`, rawSourceEnvelope());
    setMenuOpen(false);
  };
  // A report that arrives for text the author has already changed is dropped, so a
  // slow response cannot repaint diagnostics for a revision that no longer exists.
  const onReport = useCallback((next: ValidationReport, revision: string) => {
    // Two guards, both needed: a report for text that has already changed is
    // dropped outright, and the accepted one is stored with its revision so it
    // stops applying the moment the author types again.
    if (revision !== revisionRef.current) return;
    setReport({ value: next, revision });
  }, []);
  const onWorkflowChange = useCallback((next: ContentWorkflow | null) => { setWorkflow(next); setVersionsRevision(value => value + 1); }, []);

  const mutationMessage = workspace.mutation
    ? t(`mutation.${workspace.mutation.code}`, { id: refLabel(workspace.mutation.ref) })
    : null;
  const outline = <Outline manifest={state.manifest} items={state.items} selectedRef={selectedRef} onSelect={ref => select(ref)} report={displayReport} onManifestChange={workspace.changeManifest} reservedItemIds={itemIds} readOnly={editingBlocked} />;
  const readinessItem = (item: PublishCheckResult): ReadinessItem => ({
    id: item.key,
    label: header(`checklist.items.${item.key}.label`),
    status: item.state,
    detail: item.state === 'unverified' ? header('readiness.unverified')
      : item.state === 'manual' ? header('readiness.manual')
      : item.state === 'pass' ? header('readiness.noIssues')
      : header(item.kind === 'warnings' ? 'readiness.warnings' : 'readiness.issues', { count: item.diagnostics.length }),
  });
  const saveLabel = workspace.status === 'saving' ? t('saving')
    : workspace.status === 'reconciling' ? localSaveText(locale, 'reconciling')
    : workspace.status === 'conflict' ? t('conflict')
    : workspace.dirty ? t('unsaved')
    : workspace.savedAt ? `${t('saved')} · ${savedTime(workspace.savedAt, locale)}` : t('saved');

  return <div className="flex min-h-[calc(100dvh-8rem)] min-w-0 flex-col xl:h-[calc(100dvh-6rem)] xl:min-h-0">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
      <div className="flex min-w-0 items-center gap-3"><Link href={routes.studio.courses()} aria-label={t('back')} className="grid size-9 shrink-0 place-items-center rounded-md border border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><ArrowLeft className="size-4" /></Link><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><h1 className="truncate text-lg font-semibold leading-snug tracking-tight sm:text-xl">{title}</h1>{stage ? <StatusBadge kind="content" value={stage} tone={STAGE_TONES[stage]} label={header(`stages.${stage}`)} className="shrink-0" /> : null}</div><p role="status" className="mt-1 text-xs leading-snug text-muted-foreground">{readOnly ? t('readOnly') : saveLabel}</p></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => setReadinessOpen(true)} aria-haspopup="dialog" className="tabular-nums"><ClipboardCheck aria-hidden="true" />{header('readiness.button', { done: readiness.passing, total: readiness.total })}</Button>
        {!readOnly && selectedRef.kind === 'item' ? <StudioNotebookEntry courseId={state.courseId} itemId={selectedRef.id} document={state.items[selectedRef.id]} disabled={workspace.dirty || savePending || reloading} /> : null}
        {!readOnly ? <div className="flex items-center gap-2"><Button onClick={() => void workspace.save()} disabled={!workspace.dirty || savePending || reloading || workspace.status === 'conflict' || workspace.status === 'uncertain'}><Save aria-hidden="true" />{t(savePending ? 'saving' : 'save')}</Button>{workspace.error ? <span aria-live="polite" className="max-w-56 text-xs leading-snug text-warning-foreground">{localSaveText(locale, 'error')}</span> : null}</div> : null}
        <div className="relative"><Button variant="outline" size="icon" aria-label={t('more')} aria-expanded={menuOpen} aria-controls="workspace-more" onClick={() => setMenuOpen(value => !value)}><Ellipsis aria-hidden="true" className="size-5" /></Button>
          {menuOpen ? <div id="workspace-more" className="absolute right-0 top-11 z-40 flex w-64 flex-col gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground" onKeyDown={event => { if (event.key === 'Escape') setMenuOpen(false); }}>
            {!readOnly ? <ImportDialog courseId={state.courseId} manifest={state.manifest} items={state.items} canCreate={canCreate} disabled={savePending || reloading} beforeReplace={guard.requestLeave} onApply={apply} onApplyItem={applyItem} onApplySources={applySources} /> : null}
            <Button variant="secondary" onClick={exportCurrent} className="justify-start"><Download aria-hidden="true" />{t(workspace.payload ? 'export' : 'exportSources')}</Button>
            <VersionsDrawer courseId={state.courseId} refreshKey={versionsRevision} readOnly={readOnly} disabled={savePending || reloading} beforeRestore={guard.requestLeave} onRestored={apply} />
          </div> : null}
        </div>
      </div>
    </header>
    {!readOnly && workflowEnabled ? <ContentWorkflowPanel
      contentType="course"
      contentId={state.courseId}
      beforeSubmit={prepareForReview}
      getExpectedRevision={() => workspace.current.current.updatedAt}
      refreshKey={state.updatedAt ?? undefined}
      onLockChange={setWorkflowLocked}
      onWorkflowChange={onWorkflowChange}
      className="mt-3 rounded-lg border border-border bg-card p-3"
    /> : null}
    <RecoveryBanner
      candidate={recovery.candidate}
      problem={recovery.problem}
      readOnly={readOnly}
      busy={savePending || reloading}
      dirty={workspace.dirty}
      onRestore={() => { if (recovery.candidate) { applySources(recovery.candidate.record.sources); recovery.dismiss(); setNotice(t('recoveryRestored')); } }}
      onDownload={() => { if (recovery.candidate) downloadJson(`${state.courseId}-recovered-sources.json`, toRecoveryExport(recovery.candidate.record)); }}
      onDiscard={() => { void recovery.discard(); }}
      onDismiss={recovery.dismiss}
    />
    {mutationMessage ? <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
      <p>{mutationMessage}</p>
      <Button variant="secondary" onClick={workspace.clearMutation}>{t('dismiss')}</Button>
    </div> : null}
    {workspace.error || actionError ? <div role="alert" className="mt-3 rounded-md border border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">
      <p>{actionError ?? (workspace.error === 'INVALID_SOURCE' || workspace.error === 'INVALID_WORKSPACE' ? t('invalidSource')
        : workspace.error === 'SAVE_NOT_APPLIED' ? t('saveNotApplied')
        : workspace.error === 'SAVE_UNCERTAIN' ? t('saveUncertain')
        : workspace.status === 'conflict' ? t('conflictDescription') : t('saveFailed'))}</p>
      {workspace.issues.length ? <ul className="mt-2 list-disc pl-5 text-xs">{displayReport.errors.map((diagnostic, index) => <li key={`${refKey(refOf(diagnostic))}-${diagnostic.path}-${index}`}>{diagnostic.message[locale]}</li>)}</ul> : null}
      {workspace.status === 'conflict' || workspace.status === 'uncertain' ? <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={exportCurrent}>{t('exportSources')}</Button>{workspace.status === 'uncertain' ? <Button onClick={() => void workspace.reconcile()}>{localSaveText(locale, 'check')}</Button> : null}<Button onClick={() => { if (window.confirm(t('reloadConfirm'))) { setReloading(true); void workspace.reload().finally(() => setReloading(false)); } }}>{t('reload')}</Button></div> : null}
    </div> : null}
    {notice ? <p role="status" className="mt-2 text-sm text-success-foreground">{notice}</p> : null}
    <div className="my-3 flex flex-wrap items-center justify-between gap-2 xl:hidden"><Button variant="secondary" onClick={() => setTreeOpen(true)}><ListTree aria-hidden="true" />{t('contents')}</Button><div role="tablist" aria-label={t('panes')} className="flex rounded-md bg-muted p-1">{(['json', 'preview'] as const).map(value => <button key={value} id={`studio-${value}-tab`} type="button" role="tab" aria-selected={tab === value} aria-controls={`studio-${value}`} tabIndex={tab === value ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { const next = value === 'json' ? 'preview' : 'json'; setTab(next); document.getElementById(`studio-${next}-tab`)?.focus(); } }} onClick={() => setTab(value)} className="min-h-9 rounded px-4 text-sm aria-selected:bg-card focus-visible:outline-2 focus-visible:outline-ring">{t(value)}</button>)}</div></div>
    <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border xl:mt-4 xl:grid xl:grid-cols-[240px_minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="hidden min-h-0 border-r border-border bg-card xl:block">{outline}</aside>
      <section id="studio-json" role="tabpanel" aria-labelledby="studio-json-tab" aria-label={t('json')} className={cn('min-h-0 flex-col border-r border-border xl:flex', tab === 'json' ? 'flex' : 'hidden')}>
        {selectedIsMissing ? <div className="border-b border-border bg-muted px-4 py-3 text-sm">
          <p>{t('missingDocument', { id: selectedRef.kind === 'item' ? selectedRef.id : '' })}</p>
          {!editingBlocked ? <Button className="mt-2" onClick={() => { if (selectedRef.kind === 'item') workspace.materialize(selectedRef.id); }}><FilePlus2 aria-hidden="true" />{t('createStarter')}</Button> : null}
        </div> : null}
        <div id="workspace-editor" className="h-[65dvh] min-h-0 flex-none overflow-hidden xl:h-auto xl:flex-1"><JsonEditor source={source} docRef={selectedRef} diagnostics={displayReport.errors.concat(displayReport.warnings)} locale={locale} saveState={workspace.status} focusRange={focusRange} readOnly={editingBlocked || selectedIsMissing} onChange={text => workspace.changeSource(selectedRef, text)} /></div>
        <details className="max-h-48 shrink-0 overflow-auto border-t border-border bg-card"><summary className="cursor-pointer px-4 py-3 text-xs font-medium">{t('diagnostics', { errors: displayReport.errors.length, warnings: displayReport.warnings.length })}</summary><ul className="space-y-1 px-3 pb-3">{[...displayReport.errors, ...displayReport.warnings].map((diagnostic, index) => <li key={`${refKey(refOf(diagnostic))}-${diagnostic.path}-${index}`}><button type="button" className="w-full rounded px-2 py-2 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" onClick={() => openDiagnostic(diagnostic)}><span className="font-mono text-muted-foreground">{refLabel(refOf(diagnostic))}</span> · {diagnostic.message[locale]}</button></li>)}</ul></details>
      </section>
      <div id="studio-preview" role="tabpanel" aria-labelledby="studio-preview-tab" className={cn('min-h-[30rem] min-w-0 xl:block xl:min-h-0', tab === 'preview' ? 'block' : 'hidden')}><PreviewPane courseId={state.courseId} selectedRef={selectedRef} payload={workspace.payload} sourceRevision={sourceRevision} validating={workspace.analysisPending} languages={languages} defaultLanguage={defaultLanguage} onReport={onReport} /></div>
    </div>
    <Sheet open={treeOpen} onOpenChange={setTreeOpen}><SheetContent side="left" closeLabel={header('readiness.close')} className="w-[min(90vw,22rem)] gap-0 p-0"><SheetHeader className="border-b border-border p-4"><SheetTitle>{t('contents')}</SheetTitle><SheetDescription className="sr-only">{t('contentsDescription')}</SheetDescription></SheetHeader><div className="min-h-0 flex-1">{outline}</div></SheetContent></Sheet>
    <Sheet open={readinessOpen} onOpenChange={setReadinessOpen}>
      <SheetContent side="right" closeLabel={header('readiness.close')} className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="pb-4"><SheetTitle className="text-lg leading-snug">{header('readiness.title')}</SheetTitle><SheetDescription>{header('readiness.description')}</SheetDescription></SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          <ReadinessCard
            title={header('readiness.title')}
            items={readiness.items.map(readinessItem)}
            done={readiness.passing}
            total={readiness.total}
            headingLevel={3}
            // Only automatic checks waiting on a current report read "Not checked"; the manual check keeps its own label.
            statusLabels={{ unverified: header('readiness.statusUnverified') }}
          />
          <div className="min-h-0 overflow-hidden rounded-lg border border-border bg-card"><DiagnosticsPanel report={displayReport} locale={locale} onSelect={(_docId, range, diagnostic) => {
            setReadinessOpen(false); openDiagnostic(diagnostic, range);
          }} /></div>
        </div>
      </SheetContent>
    </Sheet>
    {guard.dialog}
  </div>;
}
