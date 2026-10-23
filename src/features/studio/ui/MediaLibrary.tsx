'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CopyIcon, FileText, ImageIcon, RotateCcwIcon, Upload } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ContentWorkflowPanel, type ContentWorkflow } from '@/features/content-review/ContentWorkflowPanel';
import { ContentSaveIndicator } from '@/features/content-review/ContentSaveIndicator';
import { sameContent } from '@/features/content-review/editor-snapshots';
import { contentSaveData, useContentAutosave } from '@/features/content-review/useContentAutosave';
import {
  MAX_SUBMISSION_UPLOAD_MB,
  UPLOAD_EXTENSIONS_BY_MIME,
  isUploadMimeExtensionPair,
} from '@/content-engine/schema/uploads';
import type { MediaAsset, MediaUsage } from '@/features/media/library';
import { mediaHref } from '@/features/media/urls';
import { DataCard, DataToolbar, EmptyState, FileGrid, StatCard, StatGrid, type DataToolbarFilter, type FileGridItem, type FileKind } from '@/features/staff-ui/components';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { cn } from '@/lib/ui-cn';
import { useUnsavedChanges } from './useUnsavedChanges';

export type MediaAssetWithUsages = MediaAsset & { usages: MediaUsage[] };

const ACCEPTED_MEDIA_TYPES = Object.keys(UPLOAD_EXTENSIONS_BY_MIME);
const ACCEPTED_MEDIA = new Set<string>(ACCEPTED_MEDIA_TYPES);
const MAX_MEDIA_BYTES = MAX_SUBMISSION_UPLOAD_MB * 1024 * 1024;
const FILE_KINDS: FileKind[] = ['image', 'video', 'audio', 'pdf', 'doc', 'other'];
const DOCUMENT_MIMES = /^(text\/|application\/(msword|json|x-ipynb\+json|vnd\.(ms-|openxmlformats|oasis)))/;

type UploadTask = {
  id: number;
  file: File;
  status: 'queued' | 'uploading' | 'succeeded' | 'failed';
  error: string | null;
};

function usageHref(usage: MediaUsage): string {
  if (usage.source === 'resource') return `/studio/resources/${encodeURIComponent(usage.resourceId)}`;
  if (usage.source === 'project') return `/studio/projects/${encodeURIComponent(usage.projectId)}`;
  if (usage.source === 'bank_version') return `/studio/bank/${encodeURIComponent(usage.questionId)}`;
  return `/studio/courses/${encodeURIComponent(usage.courseId)}#workspace-editor`;
}

function usageKey(usage: MediaUsage): string {
  if (usage.source === 'resource') return `resource-${usage.resourceId}`;
  if (usage.source === 'project') return `project-${usage.projectId}`;
  if (usage.source === 'bank_version') return `bank-${usage.questionId}-${usage.version}`;
  return `${usage.source}-${usage.courseId}-${usage.itemId}-${usage.version}`;
}

export function mediaFileKind(mime: string): FileKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  if (DOCUMENT_MIMES.test(mime)) return 'doc';
  return 'other';
}

/** Images need alt text in both languages; other files never count as missing. */
export function missingAltText(asset: Pick<MediaAsset, 'mime' | 'alt'>): boolean {
  return asset.mime.startsWith('image/') && (!asset.alt.vi.trim() || !asset.alt.en.trim());
}

function formatLabel(asset: Pick<MediaAsset, 'filename' | 'mime'>): string {
  const extension = asset.filename.includes('.') ? asset.filename.split('.').pop() : null;
  return (extension || asset.mime.split('/').pop() || asset.mime).toUpperCase();
}

type AltNavigationHandle = { isDirty: () => boolean; flush: () => Promise<boolean> };
type RegisterAltEditor = (id: string, handle: AltNavigationHandle) => () => void;

function AltEditor({ asset, onSaved, recoveryKey, registerEditor, onDirtyChange }: { asset: MediaAssetWithUsages; onSaved: (alt: MediaAsset['alt']) => void; recoveryKey?: string; registerEditor: RegisterAltEditor; onDirtyChange: () => void }) {
  const t = useTranslations('studio.media');
  const editorRef = useRef<HTMLDivElement>(null);
  const [vi, setVi] = useState(asset.alt.vi);
  const [en, setEn] = useState(asset.alt.en);
  const [locked, setLocked] = useState(true);
  const [mediaReady, setMediaReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const initialSource = useRef(JSON.stringify(asset.alt)).current;
  const revision = useRef<string | null>(null);
  const source = JSON.stringify({ vi, en });
  const receiveWorkflow = useCallback((workflow: ContentWorkflow | null) => {
    if (workflow && revision.current && workflow.content.revisionKey !== revision.current) setLoadError('Server version changed. Reload to compare before editing.');
  }, []);
  const saveState = useContentAutosave({
    value: source, initialValue: initialSource, valid: true, navigationGuarded: true, enabled: !locked && mediaReady && !loadError, storageKey: recoveryKey, shortcutTarget: editorRef,
    onRestore: (saved) => { try { const alt = JSON.parse(saved) as MediaAsset['alt']; if (typeof alt.vi === 'string' && typeof alt.en === 'string') { setVi(alt.vi); setEn(alt.en); } } catch { /* recovery is ignored unless it is valid alt JSON */ } },
    persist: async (snapshot, signal) => {
      const alt = JSON.parse(snapshot) as MediaAsset['alt'];
      if (!revision.current) throw new Error('Media revision is not loaded');
      const saved = await contentSaveData<{ alt?: MediaAsset['alt']; revisionKey: string }>(await fetch(`/api/v1/studio/media/${encodeURIComponent(asset.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alt, expectedRevision: revision.current }), signal }));
      const persisted = (saved.alt as MediaAsset['alt'] | undefined) ?? alt;
      onSaved(persisted);
      if (typeof saved.revisionKey !== 'string' || !saved.revisionKey) throw new Error('Missing media save revision');
      revision.current = saved.revisionKey;
      return { revision: saved.revisionKey, savedAt: new Date().toISOString() };
    },
    reconcile: async (snapshot, signal) => {
      const current = await contentSaveData<{ alt?: MediaAsset['alt']; revisionKey: string }>(await fetch(`/api/v1/studio/media/${encodeURIComponent(asset.id)}`, { signal, cache: 'no-store' }));
      if (!sameContent(current.alt, JSON.parse(snapshot)) || !current.revisionKey) return null;
      revision.current = current.revisionKey;
      return { revision: current.revisionKey, savedAt: new Date().toISOString() };
    },
  });

  const stateRef = useRef(saveState); stateRef.current = saveState;
  const sourceRef = useRef(source);
  const flushedSource = useRef<string | null>(null);
  if (sourceRef.current !== source) flushedSource.current = null;
  sourceRef.current = source;
  useEffect(() => registerEditor(asset.id, {
    // A successful flush acknowledges synchronously, before React commits dirty=false.
    isDirty: () => stateRef.current.dirty && sourceRef.current !== flushedSource.current,
    flush: async () => {
      const snapshot = sourceRef.current;
      const saved = await stateRef.current.flush();
      if (saved) flushedSource.current = snapshot;
      return saved;
    },
  }), [asset.id, registerEditor]);
  useEffect(() => { onDirtyChange(); }, [onDirtyChange, saveState.dirty, source]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError(null);
    void fetch(`/api/v1/studio/media/${encodeURIComponent(asset.id)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), cache: 'no-store' })
      .then(response => contentSaveData<{alt: MediaAsset['alt']; revisionKey: string}>(response))
      .then(detail => {
        if (controller.signal.aborted) return;
        if (!detail.revisionKey || typeof detail.alt?.vi !== 'string' || typeof detail.alt?.en !== 'string') throw new Error('Incomplete media draft');
        if (!stateRef.current.adoptServerValue(JSON.stringify(detail.alt), detail.revisionKey)) return;
        revision.current = detail.revisionKey; setMediaReady(true);
      }).catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : t('altError')); });
    return () => controller.abort();
  }, [asset.id, loadAttempt, t]);

  const inputsDisabled = locked || !mediaReady || !!loadError;
  return (
    <div ref={editorRef} className="flex flex-col gap-4">
      <ContentSaveIndicator state={saveState} disabled={inputsDisabled} />
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium leading-normal" htmlFor={`alt-vi-${asset.id}`}>{t('altVi', { id: asset.id })}</label>
        <Input id={`alt-vi-${asset.id}`} value={vi} disabled={inputsDisabled} onChange={(event) => setVi(event.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium leading-normal" htmlFor={`alt-en-${asset.id}`}>{t('altEn', { id: asset.id })}</label>
        <Input id={`alt-en-${asset.id}`} value={en} disabled={inputsDisabled} onChange={(event) => setEn(event.target.value)} />
      </div>
      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-normal text-destructive-soft-foreground">
          <span>{loadError}</span>
          <Button size="sm" variant="outline" disabled={saveState.dirty} onClick={() => setLoadAttempt(value => value + 1)}>{t('retry')}</Button>
        </div>
      ) : null}
      <ContentWorkflowPanel contentType="media_asset" contentId={asset.id} beforeSubmit={saveState.flush} getExpectedRevision={() => revision.current} onLockChange={setLocked} onWorkflowChange={receiveWorkflow} refreshKey={saveState.revision ?? undefined} className="rounded-lg border border-border p-4" />
    </div>
  );
}

function AssetPreview({ asset, locale }: { asset: MediaAssetWithUsages; locale: 'vi' | 'en' }) {
  const t = useTranslations('studio.media');
  const href = mediaHref(asset.id);
  return (
    <div className="relative grid aspect-video place-items-center overflow-hidden rounded-md border border-border bg-muted">
      {asset.mime.startsWith('image/') ? <Image src={href} alt={asset.alt[locale]} fill sizes="(min-width: 640px) 32rem, 90vw" className="object-contain" unoptimized />
        : asset.mime.startsWith('video/') ? <video className="size-full object-contain" controls preload="metadata" aria-label={t('previewFor', { name: asset.filename })} src={href} />
          : asset.mime.startsWith('audio/') ? <audio className="w-[85%]" controls preload="metadata" aria-label={t('previewFor', { name: asset.filename })} src={href} />
            : asset.mime === 'application/pdf' ? <iframe className="size-full border-0" src={href} title={t('previewFor', { name: asset.filename })} />
              : <div className="flex flex-col items-center gap-2 text-muted-foreground"><FileText aria-hidden="true" className="size-10" /><p className="text-xs leading-normal">{asset.mime}</p></div>}
    </div>
  );
}

/**
 * Studio media library as a file manager: upload dropzone, a searchable grid/list of light
 * tiles, and one details Sheet that holds the preview, usages, alt-text editor and review
 * workflow of the asset being inspected. Only the open asset loads its draft and workflow.
 */
export function MediaLibrary({ initialAssets, recoveryKeyPrefix, header }: {
  initialAssets: MediaAssetWithUsages[];
  recoveryKeyPrefix?: string;
  /** When given, the library renders the page header with "Choose files" as its one primary action. */
  header?: { eyebrow?: string; title: string; description?: string };
}) {
  const t = useTranslations('studio.media');
  const content = useTranslations('staffUi.studio.content.media');
  const format = useFormatter();
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const fileInput = useRef<HTMLInputElement>(null);
  const nextTaskId = useRef(0);
  const [assets, setAssets] = useState(initialAssets);
  const [uploading, setUploading] = useState(false);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string | undefined>>({ view: 'grid' });
  const editors = useRef(new Map<string, AltNavigationHandle>());
  const [altDirty, setAltDirty] = useState(false);
  const uploadingRef = useRef(uploading); uploadingRef.current = uploading;
  // Closing a dirty details sheet reuses the leave dialog; only the alt edits matter then, not uploads.
  const leaveTarget = useRef<'page' | 'sheet'>('page');
  const closing = useRef(false);
  const updateAltDirty = useCallback(() => {
    setAltDirty([...editors.current.values()].some(editor => editor.isDirty()));
  }, []);
  const registerEditor = useCallback<RegisterAltEditor>((id, handle) => {
    editors.current.set(id, handle);
    updateAltDirty();
    return () => {
      if (editors.current.get(id) === handle) editors.current.delete(id);
      updateAltDirty();
    };
  }, [updateAltDirty]);
  const flushAltEditors = useCallback(async () => {
    const pending = [...editors.current.values()].filter(editor => editor.isDirty());
    const results = await Promise.all(pending.map(editor => editor.flush()));
    return results.every(Boolean) && [...editors.current.values()].every(editor => !editor.isDirty());
  }, []);
  const flushEditors = useCallback(async () => {
    if (leaveTarget.current === 'sheet') return flushAltEditors();
    if (uploadingRef.current) return false;
    const saved = await flushAltEditors();
    return saved && !uploadingRef.current;
  }, [flushAltEditors]);
  const navigationGuard = useUnsavedChanges(altDirty || uploading, flushEditors);
  const requestLeave = navigationGuard.requestLeave;
  const completedUploads = useMemo(
    () => uploadTasks.filter(({ status }) => status === 'succeeded' || status === 'failed').length,
    [uploadTasks],
  );

  /** Opens another asset or closes the sheet (null); unsaved alt text asks first. */
  const showDetails = useCallback(async (next: string | null) => {
    if (closing.current) return;
    if ([...editors.current.values()].some(editor => editor.isDirty())) {
      closing.current = true;
      leaveTarget.current = 'sheet';
      let allow = false;
      try {
        allow = await requestLeave();
      } finally {
        leaveTarget.current = 'page';
        closing.current = false;
      }
      if (!allow) return;
    }
    setSheetMessage(null);
    setOpenId(next);
  }, [requestLeave]);

  async function copyText(text: string, success: string, report: (value: string) => void) {
    try {
      await navigator.clipboard.writeText(text);
      report(success);
    } catch {
      report(t('copyError'));
    }
  }

  function updateTask(id: number, update: Partial<Pick<UploadTask, 'status' | 'error'>>) {
    setUploadTasks((current) => current.map((task) => task.id === id ? { ...task, ...update } : task));
  }

  async function uploadTask(task: UploadTask): Promise<boolean> {
    if (!ACCEPTED_MEDIA.has(task.file.type)) {
      updateTask(task.id, { status: 'failed', error: t('unsupportedType', { type: task.file.type || t('unknownType') }) });
      return false;
    }
    if (!isUploadMimeExtensionPair(task.file.name, task.file.type)) {
      updateTask(task.id, { status: 'failed', error: t('mimeMismatch', { name: task.file.name, type: task.file.type }) });
      return false;
    }
    if (task.file.size > MAX_MEDIA_BYTES) {
      updateTask(task.id, { status: 'failed', error: t('tooLarge') });
      return false;
    }
    updateTask(task.id, { status: 'uploading', error: null });
    try {
      const form = new FormData();
      form.set('file', task.file);
      const response = await fetch('/api/v1/studio/media', { method: 'POST', body: form });
      const body = await response.json() as { data?: { id?: string; mime?: string; sizeBytes?: number; width?: number | null; height?: number | null }; error?: { message?: string } };
      if (!response.ok || !body.data?.id || !body.data.mime || typeof body.data.sizeBytes !== 'number') {
        throw new Error(body.error?.message ?? t('uploadError'));
      }
      const uploaded: MediaAssetWithUsages = {
        id: body.data.id,
        mime: body.data.mime,
        sizeBytes: body.data.sizeBytes,
        width: body.data.width ?? null,
        height: body.data.height ?? null,
        filename: task.file.name,
        alt: { vi: '', en: '' },
        createdAt: new Date().toISOString(),
        usages: [],
      };
      setAssets((current) => [uploaded, ...current.filter(({ id }) => id !== uploaded.id)]);
      updateTask(task.id, { status: 'succeeded', error: null });
      return true;
    } catch (caught) {
      updateTask(task.id, { status: 'failed', error: caught instanceof Error ? caught.message : t('uploadError') });
      return false;
    }
  }

  async function uploadFiles(files: File[]) {
    if (files.length === 0 || uploading) return;
    const tasks = files.map((file): UploadTask => ({
      id: ++nextTaskId.current,
      file,
      status: 'queued',
      error: null,
    }));
    setUploadTasks((current) => [...tasks, ...current]);
    setUploading(true);
    setMessage(null);
    let succeeded = 0;
    for (const task of tasks) {
      if (await uploadTask(task)) succeeded += 1;
    }
    setMessage(succeeded === tasks.length
      ? t('uploadSuccess', { count: succeeded })
      : t('uploadSummary', { succeeded, failed: tasks.length - succeeded }));
    if (fileInput.current) fileInput.current.value = '';
    setUploading(false);
  }

  async function retryTask(task: UploadTask) {
    if (uploading) return;
    setUploading(true);
    setMessage(null);
    const succeeded = await uploadTask(task);
    setMessage(succeeded ? t('retrySuccess', { name: task.file.name }) : t('retryFailed', { name: task.file.name }));
    setUploading(false);
  }

  const sizeLabel = (bytes: number) => bytes >= 1024 * 1024
    ? format.number(bytes / 1024 / 1024, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 })
    : format.number(Math.max(bytes, 1) / 1024, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 1 });

  const kindsPresent = FILE_KINDS.filter((kind) => assets.some((asset) => mediaFileKind(asset.mime) === kind));
  const filters: DataToolbarFilter[] = [
    ...(kindsPresent.length > 1 ? [{ param: 'kind', label: content('typeFilter'), allLabel: content('allTypes'), options: kindsPresent.map((kind) => ({ value: kind, label: content(`types.${kind}`) })) }] : []),
    ...(assets.some((asset) => asset.mime.startsWith('image/')) ? [{
      param: 'alt',
      label: content('altFilter'),
      allLabel: content('allAlt'),
      options: [
        { value: 'missing', label: content('altOptions.missing') },
        { value: 'complete', label: content('altOptions.complete') },
      ],
    }] : []),
  ];

  const visibleAssets = useMemo(() => {
    const query = (values.q ?? '').trim().toLocaleLowerCase();
    return assets.filter((asset) => {
      if (values.kind && mediaFileKind(asset.mime) !== values.kind) return false;
      if (values.alt === 'missing' && !missingAltText(asset)) return false;
      if (values.alt === 'complete' && (!asset.mime.startsWith('image/') || missingAltText(asset))) return false;
      return !query || asset.filename.toLocaleLowerCase().includes(query) || asset.id.toLocaleLowerCase().includes(query);
    });
  }, [assets, values]);

  const items: FileGridItem[] = visibleAssets.map((asset) => ({
    id: asset.id,
    name: asset.filename,
    kind: mediaFileKind(asset.mime),
    thumbnailUrl: asset.mime.startsWith('image/') ? mediaHref(asset.id) : null,
    meta: `${formatLabel(asset)} · ${sizeLabel(asset.sizeBytes)} · ${t('usages', { count: asset.usages.length })}`,
    status: missingAltText(asset) ? { tone: 'warning' as const, label: content('missingAlt') } : undefined,
  }));

  const openAsset = openId ? assets.find((asset) => asset.id === openId) ?? null : null;
  const view = values.view === 'grid' ? 'grid' : 'list';

  const fileInputElement = <input ref={fileInput} id="media-upload" className="sr-only" type="file" multiple disabled={uploading} aria-label={t('chooseFiles')} accept={ACCEPTED_MEDIA_TYPES.join(',')} onChange={(event) => void uploadFiles([...(event.target.files ?? [])])} />;
  const chooseButton = (
    <Button disabled={uploading} onClick={() => fileInput.current?.click()}>
      <Upload aria-hidden="true" />
      {uploading ? t('uploading') : t('chooseFiles')}
    </Button>
  );
  const dropHandlers = {
    onDragEnter: (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); if (!uploading) setDragging(true); },
    onDragOver: (event: DragEvent<HTMLDivElement>) => event.preventDefault(),
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); if (!uploading) void uploadFiles([...event.dataTransfer.files]); },
  };
  const missingAltCount = assets.filter((asset) => missingAltText(asset)).length;
  const storageBytes = assets.reduce((sum, asset) => sum + asset.sizeBytes, 0);

  return (
    <div className="flex flex-col gap-6">
      {header ? (
        <>
          <StaffPageHeader eyebrow={header.eyebrow} title={header.title} description={header.description} actions={chooseButton} />
          {/* Every asset is loaded, so these are honest snapshot counts. */}
          {assets.length ? (
            <StatGrid aria-label={content('stats.label')}>
              <StatCard label={content('stats.total')} value={assets.length} />
              <StatCard label={content('stats.storage')} value={sizeLabel(storageBytes)} />
              <StatCard label={content('stats.missingAlt')} value={missingAltCount} />
            </StatGrid>
          ) : null}
          {/* A compact drop strip; the header button is the primary way to upload. */}
          <div
            aria-disabled={uploading}
            className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors motion-reduce:transition-none', dragging ? 'border-foreground/40 bg-accent' : 'border-border bg-card', uploading && 'opacity-70')}
            {...dropHandlers}
          >
            <Upload aria-hidden="true" className="size-4 text-muted-foreground" />
            <p className="font-medium leading-normal">{t('drop')}</p>
            <p className="leading-normal text-muted-foreground">{t('limits')}</p>
            {fileInputElement}
            <p aria-live="polite" className="basis-full leading-normal text-muted-foreground empty:hidden">{message}</p>
          </div>
        </>
      ) : (
        <div
          aria-disabled={uploading}
          className={cn('flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center transition-colors motion-reduce:transition-none', dragging ? 'border-foreground/40 bg-accent' : 'border-border bg-card', uploading && 'opacity-70')}
          {...dropHandlers}
        >
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground"><Upload className="size-5" /></span>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium leading-normal">{t('drop')}</p>
            <p className="text-sm leading-normal text-muted-foreground">{t('limits')}</p>
          </div>
          {fileInputElement}
          {chooseButton}
          <p aria-live="polite" className="min-h-5 text-sm leading-normal text-muted-foreground">{message}</p>
        </div>
      )}

      {uploadTasks.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6" aria-label={t('uploadProgress')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium leading-normal tabular-nums">{t('uploadProgressCount', { completed: completedUploads, total: uploadTasks.length })}</p>
            <progress aria-label={t('uploadProgress')} className="h-2 w-40 accent-primary" max={uploadTasks.length} value={completedUploads}>{completedUploads}/{uploadTasks.length}</progress>
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {uploadTasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm leading-normal">
                <span className="min-w-0 truncate">{task.file.name} · {t(`uploadStatus.${task.status}`)}</span>
                {task.error ? <span className="text-destructive">{task.error}</span> : null}
                {task.status === 'failed' ? (
                  <Button size="sm" variant="outline" disabled={uploading} aria-label={t('retryFor', { name: task.file.name })} onClick={() => void retryTask(task)}>
                    <RotateCcwIcon aria-hidden="true" />
                    {t('retry')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DataCard
        title={content('filesTitle')}
        toolbar={assets.length > 0 ? (
          <DataToolbar
            values={values}
            onValuesChange={setValues}
            searchLabel={content('search')}
            searchPlaceholder={content('search')}
            filters={filters}
            viewToggle
            actions={(
              <Button variant="outline" disabled={selected.length === 0} aria-label={t('copySelected')} onClick={() => void copyText(selected.join('\n'), t('selectedCopied', { count: selected.length }), setMessage)}>
                <CopyIcon aria-hidden="true" />
                {/* Icon-only on phones so the toolbar never overflows the card. */}
                <span className="hidden sm:inline">{t('copySelected')}</span>
              </Button>
            )}
          />
        ) : undefined}
      >
        <div className="p-6">
          {assets.length === 0 ? (
            <EmptyState icon={<ImageIcon />} title={t('empty')} />
          ) : (
            <FileGrid
              items={items}
              view={view}
              selectable
              selectedIds={selected}
              onSelectionChange={setSelected}
              onOpen={(item) => void showDetails(item.id)}
              label={content('filesTitle')}
              emptyLabel={content('noMatches')}
              selectLabel={(item) => t('selectFor', { id: item.id })}
              openLabel={(item) => content('openDetails', { name: item.name })}
            />
          )}
        </div>
      </DataCard>

      <Sheet open={openAsset !== null} onOpenChange={(open) => { if (!open) void showDetails(null); }}>
        {openAsset ? (
          <SheetContent side="right" closeLabel={content('close')} className="w-full gap-0 overflow-y-auto sm:max-w-lg">
            <SheetHeader className="pr-12">
              <SheetTitle className="break-words leading-snug">{openAsset.filename}</SheetTitle>
              <SheetDescription className="break-all leading-normal">{openAsset.id}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-6 p-6">
              <AssetPreview asset={openAsset} locale={locale} />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" aria-label={t('copyFor', { id: openAsset.id })} onClick={() => void copyText(openAsset.id, t('copied', { id: openAsset.id }), setSheetMessage)}>
                  <CopyIcon aria-hidden="true" />
                  {t('copy')}
                </Button>
                <p aria-live="polite" className="text-sm leading-normal text-muted-foreground">{sheetMessage}</p>
              </div>
              <section aria-labelledby="media-details-heading" className="flex flex-col gap-3">
                <h3 id="media-details-heading" className="text-sm font-medium leading-snug">{content('details')}</h3>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm leading-normal">
                  <dt className="text-muted-foreground">{content('fields.type')}</dt>
                  <dd className="break-all">{openAsset.mime}</dd>
                  <dt className="text-muted-foreground">{content('fields.size')}</dt>
                  <dd className="tabular-nums">{sizeLabel(openAsset.sizeBytes)}</dd>
                  {openAsset.width && openAsset.height ? (
                    <>
                      <dt className="text-muted-foreground">{content('fields.dimensions')}</dt>
                      <dd className="tabular-nums">{openAsset.width} × {openAsset.height}</dd>
                    </>
                  ) : null}
                  {openAsset.createdAt ? (
                    <>
                      <dt className="text-muted-foreground">{content('fields.created')}</dt>
                      <dd className="tabular-nums">{format.dateTime(new Date(openAsset.createdAt), { dateStyle: 'medium' })}</dd>
                    </>
                  ) : null}
                </dl>
              </section>
              <section aria-labelledby="media-usages-heading" className="flex flex-col gap-3">
                <h3 id="media-usages-heading" className="text-sm font-medium leading-snug">{content('usagesTitle')} <span className="font-normal text-muted-foreground tabular-nums">· {t('usages', { count: openAsset.usages.length })}</span></h3>
                {openAsset.usages.length > 0 ? (
                  <ul className="flex flex-col gap-1 text-sm leading-normal">
                    {openAsset.usages.map((usage) => {
                      const label = usage.source === 'resource'
                        ? t('resourceUsage', { id: usage.resourceId })
                        : usage.source === 'project'
                          ? t('projectUsage', { id: usage.projectId })
                          : usage.source === 'bank_version'
                            ? `Bank ${usage.questionId} · v${usage.version}`
                            : t('courseUsage', { courseId: usage.courseId, itemId: usage.itemId, version: usage.version === null ? t('draft') : `v${usage.version}` });
                      return <li key={usageKey(usage)}><Link className="underline-offset-4 hover:underline" href={usageHref(usage)}>{label}</Link></li>;
                    })}
                  </ul>
                ) : <p className="text-sm leading-normal text-muted-foreground">{content('notUsed')}</p>}
              </section>
              <section aria-labelledby="media-alt-heading" className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h3 id="media-alt-heading" className="text-sm font-medium leading-snug">{content('altTitle')}</h3>
                  <p className="text-sm leading-normal text-muted-foreground">{content('altDescription')}</p>
                </div>
                <AltEditor
                  key={openAsset.id}
                  asset={openAsset}
                  registerEditor={registerEditor}
                  onDirtyChange={updateAltDirty}
                  recoveryKey={recoveryKeyPrefix ? `${recoveryKeyPrefix}:media:${openAsset.id}` : undefined}
                  onSaved={(alt) => setAssets((current) => current.map((value) => value.id === openAsset.id ? { ...value, alt } : value))}
                />
              </section>
            </div>
          </SheetContent>
        ) : null}
      </Sheet>
      {navigationGuard.dialog}
    </div>
  );
}
