'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ExamAnswerRecovery } from './answer-recovery';
import { useSupportUnsaved } from '@/features/workspace-ui/support/useSupportUnsaved';

export function OwnAnswerDownload({ getRecovery, label }: { getRecovery: () => ExamAnswerRecovery; label: string }) {
  const t = useTranslations('exam.recovery');
  const urls = useRef(new Set<string>());
  const [downloadError, setDownloadError] = useState(false);
  useEffect(() => {
    const current = urls.current;
    return () => { current.forEach(url => URL.revokeObjectURL(url)); current.clear(); };
  }, []);
  const download = () => {
    try {
      const recovery = getRecovery();
      const ownCopy = { attemptId: recovery.attemptId, attemptNo: recovery.attemptNo, verification: recovery.verified ? 'confirmed-unaccepted' : 'unverified', answers: recovery.answers };
      const url = URL.createObjectURL(new Blob([JSON.stringify(ownCopy, null, 2)], { type: 'application/json' }));
      urls.current.add(url);
      const link = document.createElement('a');
      link.href = url;
      link.download = `exam-attempt-${recovery.attemptNo}-local-answers.json`;
      link.hidden = true;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
      setDownloadError(false);
    } catch { setDownloadError(true); }
  };
  return <><button type="button" className="vf-btn vf-btn-lg" onClick={download}>{label}</button>{downloadError ? <p className="m-0 text-sm" role="alert">{t('downloadError')}</p> : null}</>;
}

export function ExamAnswerRecoveryNotice({ recoveries, protectExit = true }: { recoveries: readonly ExamAnswerRecovery[]; protectExit?: boolean }) {
  const t = useTranslations('exam.recovery');
  useSupportUnsaved(protectExit && recoveries.some(recovery => recovery.storageUnavailable), t('leaveUnavailable'));
  if (recoveries.length === 0) return null;
  return <section aria-label={t('title')} className="mb-6 grid gap-4 rounded-md border border-warning-border bg-warning p-4 text-warning-foreground">
    <p className="m-0 font-semibold">{t('title')}</p>
    {recoveries.map(recovery => <div key={recovery.attemptId} className="grid justify-items-start gap-2">
      <p className="m-0 text-sm" role="alert">{t(recovery.verified ? 'description' : 'unverified')}</p>
      <OwnAnswerDownload getRecovery={() => recovery} label={t('download', { attempt: recovery.attemptNo })} />
      {recovery.storageUnavailable ? <p className="m-0 text-sm">{t('storageUnavailable')}</p> : null}
    </div>)}
  </section>;
}
