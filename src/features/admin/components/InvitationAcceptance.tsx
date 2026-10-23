'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/classic';
import { responseData } from './member-admin-ui';

export function InvitationAcceptance({ token, destination, canAccessAdmin }: { token: string; destination: '/app' | '/admin' | '/studio' | '/grading'; canAccessAdmin: boolean }) {
  const t = useTranslations('memberAdmin');
  const common = useTranslations('common');
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [failed, setFailed] = useState(false);

  async function accept() {
    setAccepting(true); setFailed(false);
    try {
      const result = await responseData<{ accepted: true; branchId: string }>(await fetch('/api/v1/admin/invitations/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      }));
      if (!result.accepted) throw new Error('not_accepted');
      setAccepted(true);
    } catch { setFailed(true); }
    finally { setAccepting(false); }
  }

  return <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-12"><section className="w-full space-y-6 rounded-lg border border-border bg-card p-6 shadow-sm" aria-labelledby="invite-acceptance-title"><div><p className="font-mono text-xs font-medium tracking-[0.16em] text-primary uppercase">VFUTURE</p><h1 id="invite-acceptance-title" className="mt-3 text-2xl font-semibold tracking-tight">{t('acceptInvitation')}</h1><p className="mt-2 text-muted-foreground">{t('acceptInviteDescription')}</p></div>{accepted ? <div className="space-y-4" role="status" aria-live="polite"><p className="text-emerald-700">{t('invitationAccepted')}</p><Link href={destination} className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{destination === '/studio' ? common('openStudio') : destination === '/grading' ? common('openGrading') : canAccessAdmin ? t('continueToAdmin') : t('continueToApp')}</Link></div> : <div className="space-y-4">{failed ? <p role="alert" className="text-sm text-destructive">{t('inviteAcceptError')}</p> : null}<div className="flex flex-wrap gap-3"><Button disabled={accepting} onClick={() => void accept()}>{accepting ? t('acceptingInvitation') : t('acceptInvitation')}</Button>{failed ? <Button className="bg-secondary text-secondary-foreground hover:bg-secondary/80" disabled={accepting} onClick={() => void accept()}>{t('retry')}</Button> : null}</div></div>}</section></main>;
}
