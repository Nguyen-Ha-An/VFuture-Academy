'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export function ProjectInterestButton({
  projectId,
  initialInterested,
}: {
  projectId: string;
  initialInterested: boolean;
}) {
  const t = useTranslations('build.interest');
  const [interested, setInterested] = useState(initialInterested);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  async function update() {
    if (pending) return;
    const desired = !interested;
    setPending(true);
    setMessage('');
    setFailed(false);
    try {
      const response = await fetch(`/api/v1/projects/${encodeURIComponent(projectId)}/interest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interested: desired }),
      });
      if (!response.ok) throw new Error(`Interest update failed with status ${response.status}`);
      const envelope = await response.json() as { data?: { interested?: boolean } };
      setInterested(envelope.data?.interested === true);
      setMessage(t('saved'));
    } catch {
      // Server and network messages are English and technical; the learner sees the localized one.
      setFailed(true);
      setMessage(t('error'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" className={interested ? 'vf-btn vf-btn-lg' : 'vf-btn vf-btn-primary vf-btn-lg'} aria-pressed={interested} disabled={pending} onClick={update}>
        {pending ? t('saving') : interested ? t('added') : t('add')}
      </button>
      <p role="status" aria-live="polite" data-tone={failed ? 'fault' : undefined}>{message}</p>
    </div>
  );
}
