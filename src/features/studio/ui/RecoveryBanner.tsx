"use client";

import { AlertTriangle, Download, RotateCcw, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/classic';
import type { RecoveryCandidate, RecoveryStorageProblem } from './useLocalRecovery';

/**
 * Recovery is always a choice, never an action taken for the author. The banner
 * states what was found, warns when the server draft has moved on since, and keeps
 * Download available even when nothing can be restored.
 */
export function RecoveryBanner({ candidate, problem, readOnly, busy, dirty, onRestore, onDownload, onDiscard, onDismiss }: {
  candidate: RecoveryCandidate | null;
  problem: RecoveryStorageProblem | null;
  readOnly?: boolean;
  busy?: boolean;
  /** The editor already holds unsaved edits, which a restore would replace. */
  dirty?: boolean;
  onRestore: () => void;
  onDownload: () => void;
  onDiscard: () => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('studioWorkspace');
  const locale = useLocale();
  const [confirmed, setConfirmed] = useState(false);
  if (!candidate && !problem) return null;

  const when = candidate
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(candidate.record.modifiedAt))
    : '';
  const documents = candidate ? Object.keys(candidate.record.sources).length : 0;
  // Restore replaces every raw source in the editor, so it is as destructive as a
  // whole-course import — and it gets the same single, explicit confirmation when
  // there is actually something to lose. One checkbox, not a chain of prompts.
  const destructive = Boolean(candidate && (candidate.serverIsNewer || dirty));
  const blocked = destructive && !confirmed;

  return <div className="mt-3 space-y-2">
    {problem ? <p role="status" className="flex items-start gap-2 rounded-md border border-border bg-muted px-4 py-3 text-sm">
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <span>{t(problem === 'quota' ? 'recoveryQuota' : problem === 'unavailable' ? 'recoveryUnavailable' : 'recoveryFailed')}</span>
    </p> : null}
    {candidate ? <section aria-labelledby="studio-recovery-title" className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <h2 id="studio-recovery-title" className="font-semibold">{t('recoveryTitle')}</h2>
      <p className="mt-1">{t('recoveryDescription', { when, documents })}</p>
      {candidate.serverIsNewer ? <p role="alert" className="mt-2 font-medium">{t('recoveryServerNewer')}</p> : null}
      {readOnly ? <p className="mt-2">{t('recoveryReadOnly')}</p> : null}
      {!readOnly && destructive ? <label className="mt-3 flex min-h-10 items-start gap-3 rounded-md border border-amber-300 bg-amber-100/60 p-3">
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-0.5 size-5 accent-primary" />
        <span>{t(candidate.serverIsNewer ? 'recoveryConfirmServerNewer' : 'recoveryConfirmDirty')}</span>
      </label> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {!readOnly ? <Button disabled={busy || blocked} onClick={onRestore}><RotateCcw aria-hidden="true" className="mr-2 size-4" />{t('recoveryRestore')}</Button> : null}
        <Button disabled={busy} onClick={onDownload} className="bg-secondary text-secondary-foreground hover:bg-accent"><Download aria-hidden="true" className="mr-2 size-4" />{t('recoveryDownload')}</Button>
        <Button disabled={busy} onClick={onDiscard} className="bg-secondary text-secondary-foreground hover:bg-accent"><Trash2 aria-hidden="true" className="mr-2 size-4" />{t('recoveryDiscard')}</Button>
        <Button disabled={busy} onClick={onDismiss} className="bg-transparent text-amber-950 shadow-none hover:bg-amber-100">{t('recoveryKeep')}</Button>
      </div>
    </section> : null}
  </div>;
}
