'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';

import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/features/staff-ui/components/StatusBadge';
import { sameContentRevision } from './revision';
import { workflowCopy } from './workflow-copy';

export type ContentWorkflow = {
  content: { contentType: string; contentId: string; revisionKey: string; status: string; publishedRevisionKey: string | null };
  activeReview: { id: string; status: string; revisionKey: string; note: string | null } | null;
  publication: { revisionKey: string; publishedAt: string } | null;
  actions: { requestReview: boolean; withdrawReview: boolean; approveAndPublish: boolean; mutate: boolean };
};
/**
 * What `beforeSubmit` reports: `true` (or `{ ok: true }`) lets the submission continue; plain
 * `false` means the editor could not be saved; `{ ok: false, message }` stops with that message,
 * e.g. the validation errors that block the review.
 */
export type BeforeSubmitResult = boolean | { ok: true } | { ok: false; message: string };
export type ContentWorkflowPanelProps = {
  contentType: string; contentId: string; beforeSubmit?: () => Promise<BeforeSubmitResult>; refreshKey?: string | number;
  getExpectedRevision?: () => string | null;
  locale?: string; className?: string; onLockChange?: (locked: boolean) => void; onWorkflowChange?: (workflow: ContentWorkflow | null) => void;
};
type Envelope<T> = { data?: T; error?: { message?: string } };
const endpoint = (type: string, id: string) => `/api/v1/studio/content/${encodeURIComponent(type)}/${encodeURIComponent(id)}/workflow`;

async function read<T>(url: string, init?: RequestInit): Promise<T> {
  const timeout = AbortSignal.timeout(15_000);
  const response = await fetch(url, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  const body = await response.json() as Envelope<T>;
  if (!response.ok) throw new Error(body.error?.message || 'Request failed');
  if (!body.data) throw new Error('Response did not include workflow data');
  return body.data;
}

function editingLivePublication(workflow: ContentWorkflow | null) {
  return workflow !== null && (workflow.content.status === 'published' || (workflow.content.publishedRevisionKey !== null && workflow.content.revisionKey === workflow.content.publishedRevisionKey));
}

function workflowMessage(workflow: ContentWorkflow, copy: ReturnType<typeof workflowCopy>) {
  const review = workflow.activeReview?.status;
  if (review === 'pending') return copy.pending;
  if (review === 'changes_requested') return copy.changesRequested;
  if (review === 'stale') return copy.stale;
  if (review === 'withdrawn') return copy.withdrawn;
  return editingLivePublication(workflow) ? copy.published : copy.draft;
}

/** Author workflow; editing stays locked until server workflow state is known. */
export function ContentWorkflowPanel(props: ContentWorkflowPanelProps) {
  const { contentType, contentId, beforeSubmit, refreshKey, locale, className, onLockChange, onWorkflowChange, getExpectedRevision } = props;
  const contextLocale = useLocale();
  const copy = useMemo(() => workflowCopy(locale ?? contextLocale), [contextLocale, locale]);
  const [workflow, setWorkflow] = useState<ContentWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'flushing' | 'submit' | 'withdraw' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisionMode, setRevisionMode] = useState(false);
  const callbacks = useRef({ onLockChange, onWorkflowChange });
  callbacks.current = { onLockChange, onWorkflowChange };
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const locked = !workflow || workflow.content.contentId !== contentId || workflow.content.contentType !== contentType || busy === 'submit' || busy === 'withdraw' || workflow.actions.mutate === false || workflow.activeReview?.status === 'pending' || (editingLivePublication(workflow) && !revisionMode);
  useEffect(() => { callbacks.current.onLockChange?.(locked); }, [locked]);

  const apply = useCallback((next: ContentWorkflow | null) => {
    setWorkflow(next);
    callbacks.current.onWorkflowChange?.(next);
    if (!editingLivePublication(next)) setRevisionMode(false);
  }, []);

  const reload = useCallback(async () => {
    const request = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError(null);
    try {
      const next = await read<ContentWorkflow>(endpoint(contentType, contentId), { signal: abort.signal });
      if (request === sequence.current) apply(next);
    } catch (cause) {
      if (abort.signal.aborted || request !== sequence.current) return;
      apply(null);
      setError(cause instanceof Error ? cause.message : copy.loadError);
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [apply, contentId, contentType, copy.loadError]);

  useEffect(() => { void reload(); return () => controller.current?.abort(); }, [reload, refreshKey]);
  useEffect(() => {
    if (workflow?.activeReview?.status !== 'pending') return;
    const refresh = () => void reload();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [reload, workflow?.activeReview?.status]);

  async function submit() {
    if (!workflow || busy || !workflow.actions.requestReview) return;
    setBusy('flushing'); setError(null);
    try {
      if (beforeSubmit) {
        const prepared = await beforeSubmit();
        if (prepared === false) { setError(copy.saveFirst); return; }
        if (typeof prepared === 'object' && !prepared.ok) { setError(prepared.message.trim() || copy.saveFirst); return; }
      }
      setBusy('submit');
      const expected = getExpectedRevision?.();
      const current = await read<ContentWorkflow>(endpoint(contentType, contentId));
      if (getExpectedRevision && !sameContentRevision(contentType, expected ?? null, current.content.revisionKey)) {
        setError(copy.changed);
        return;
      }
      apply(current);
      if (!current.actions.requestReview || editingLivePublication(current)) { setError(copy.saveFirst); return; }
      await read(`${endpoint(contentType, contentId).replace('/workflow', '')}/reviews`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: current.content.revisionKey }),
      });
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.loadError); }
    finally { setBusy(null); }
  }

  async function withdraw() {
    if (!workflow?.activeReview || busy || !workflow.actions.withdrawReview) return;
    setBusy('withdraw'); setError(null);
    try {
      await read(`/api/v1/studio/reviews/${encodeURIComponent(workflow.activeReview.id)}/withdraw`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : copy.loadError); }
    finally { setBusy(null); }
  }

  const live = workflow ? editingLivePublication(workflow) : false;
  return <section className={className ?? 'rounded-xl border border-border bg-card p-4'} aria-label={copy.workflow}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="content" value={live ? 'published' : 'draft'} label={live ? copy.live : copy.draftRevision} />
          <p role="status" aria-live="polite" className="text-sm font-medium">{loading ? copy.loading : workflow ? workflowMessage(workflow, copy) : copy.loadError}</p>
        </div>
        {workflow ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer select-none">{copy.technicalDetails}</summary><dl className="mt-2 grid gap-x-5 gap-y-1 sm:grid-cols-2"><div><dt>{copy.currentRevision}</dt><dd className="break-all font-mono">{workflow.content.revisionKey}</dd></div>{workflow.publication ? <div><dt>{copy.liveRevision}</dt><dd className="break-all font-mono">{workflow.publication.revisionKey}</dd></div> : null}</dl></details> : null}
        {workflow?.activeReview?.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{workflow.activeReview.note}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {workflow?.actions.withdrawReview && workflow.activeReview?.status === 'pending' ? <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void withdraw()}>{busy === 'withdraw' ? copy.withdrawing : copy.withdraw}</Button> : null}
        {editingLivePublication(workflow) && !revisionMode ? <Button type="button" disabled={busy !== null} onClick={() => setRevisionMode(true)}>{copy.createRevision}</Button> : null}
        {workflow?.actions.requestReview && (!editingLivePublication(workflow) || revisionMode) ? <Button type="button" disabled={busy !== null || loading} onClick={() => void submit()}>{busy === 'submit' || busy === 'flushing' ? copy.submitting : copy.submit}</Button> : null}
        <Button type="button" variant="outline" disabled={loading || busy !== null} onClick={() => void reload()}>{copy.reload}</Button>
      </div>
    </div>
    {error ? <p role="alert" className="mt-3 whitespace-pre-line rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p> : null}
  </section>;
}
