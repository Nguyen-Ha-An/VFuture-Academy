'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import type { OpportunityAvailability } from '@/features/opportunities/availability';
import { safeApplicationUrl } from '@/features/opportunities/schema';
import { track } from '@/lib/analytics-client';

export function OpportunityViewTracker({ opportunityId }: { opportunityId: string }) {
  useEffect(() => {
    track('opportunity.viewed', { opportunityId });
  }, [opportunityId]);
  return null;
}

export function OpportunityAction({
  opportunityId,
  applicationUrl,
  internalApplication,
  initiallyInterested,
  availability = 'open',
  eligible = true,
}: {
  opportunityId: string;
  applicationUrl: string | null;
  internalApplication: boolean;
  initiallyInterested: boolean;
  availability?: OpportunityAvailability;
  eligible?: boolean;
}) {
  const t = useTranslations('opportunities.action');
  const [interested, setInterested] = useState(initiallyInterested);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [failedDesired, setFailedDesired] = useState<boolean | null>(null);
  const pendingRef = useRef(false);
  const safeUrl = safeApplicationUrl(applicationUrl);

  if (!internalApplication && safeUrl) {
    if (availability !== 'open' || !eligible) return null;
    return (
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="vf-btn vf-btn-primary vf-btn-lg"
        onClick={() => track('opportunity.clicked', { opportunityId, application: 'external' })}
      >
        {t('apply')}
      </a>
    );
  }

  if (!internalApplication) return null;

  async function updateInterest(next: boolean) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setStatus('');
    setFailedDesired(null);
    track('opportunity.clicked', { opportunityId, application: 'internal' });
    try {
      const response = await fetch(`/api/v1/opportunities/${encodeURIComponent(opportunityId)}/interest`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interested: next }),
      });
      const body = await response.json() as { data?: { interested?: unknown } };
      if (!response.ok || typeof body.data?.interested !== 'boolean') throw new Error('interest_failed');
      setInterested(body.data.interested);
      setStatus(body.data.interested ? t('saved') : t('removed'));
    } catch {
      setStatus(t('error'));
      setFailedDesired(next);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" className={interested ? 'vf-btn vf-btn-lg' : 'vf-btn vf-btn-primary vf-btn-lg'} onClick={() => void updateInterest(!interested)} disabled={pending} aria-pressed={interested}>
        {interested ? t('remove') : t('interested')}
      </button>
      {failedDesired === null
        ? <p role="status" aria-live="polite">{status}</p>
        : <div role="alert"><p>{status}</p><button type="button" className="vf-btn vf-btn-lg" onClick={() => void updateInterest(failedDesired)} disabled={pending}>{t('retry')}</button></div>}
    </div>
  );
}
