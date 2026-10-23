'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SectionCard } from '@/features/staff-ui/components';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { responseData, scopedUrl } from './member-admin-ui';

type McpBlockStatus = {
  userId: string;
  blocked: boolean;
  reason: string | null;
  blockedAt: string | null;
  blockedBy: string | null;
  scope: 'all-mcp-clients';
  oauthGrantRevoked: false;
};

const USER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function McpBlockView({
  initialUserId,
  actorId,
}: {
  initialUserId: string;
  actorId: string;
}) {
  const t = useTranslations('staffUi.admin.mcp');
  const locale = useLocale();
  const [inputUserId, setInputUserId] = useState(initialUserId);
  const [status, setStatus] = useState<McpBlockStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [invalidUserId, setInvalidUserId] = useState(false);
  const [pending, setPending] = useState<'block' | 'unblock' | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);

  const load = useCallback(async (userId: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const sequence = ++sequenceRef.current;
    setStatus(null);
    setLookupFailed(false);
    setInvalidUserId(false);
    setLoading(true);
    try {
      const next = await responseData<McpBlockStatus>(
        await fetch(scopedUrl('/api/v1/admin/mcp/blocks', { kind: 'central' }, { actorId, userId }), {
          cache: 'no-store',
          signal: controller.signal,
        }),
      );
      if (next.userId.toLowerCase() !== userId.toLowerCase() || typeof next.blocked !== 'boolean') {
        throw new Error('Unexpected MCP block status');
      }
      if (sequence === sequenceRef.current) setStatus(next);
    } catch (error) {
      if (sequence === sequenceRef.current && (error as Error).name !== 'AbortError') {
        setLookupFailed(true);
      }
    } finally {
      if (sequence === sequenceRef.current) setLoading(false);
    }
  }, [actorId]);

  useEffect(() => {
    const userId = initialUserId.trim();
    if (USER_UUID.test(userId)) void load(userId);
    return () => requestRef.current?.abort();
  }, [initialUserId, load]);

  function changeTarget(value: string) {
    requestRef.current?.abort();
    sequenceRef.current += 1;
    setInputUserId(value);
    setStatus(null);
    setLoading(false);
    setLookupFailed(false);
    setInvalidUserId(false);
    setAnnouncement('');
    setPending(null);
  }

  function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userId = inputUserId.trim();
    if (!USER_UUID.test(userId)) {
      setInvalidUserId(true);
      setStatus(null);
      return;
    }
    setInputUserId(userId);
    setAnnouncement('');
    void load(userId);
  }

  async function save() {
    if (!pending || !status || saving) return;
    const action = pending;
    const userId = status.userId;
    setSaving(true);
    setSaveFailed(false);
    try {
      const response = await fetch(scopedUrl('/api/v1/admin/mcp/blocks', { kind: 'central' }, { actorId }), {
        method: action === 'block' ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'block' && reason.trim()
          ? { userId, reason: reason.trim() }
          : { userId }),
      });
      if (!response.ok) throw new Error('request_failed');
      setPending(null);
      setReason('');
      setAnnouncement(t(action === 'block' ? 'blockedSaved' : 'unblockedSaved'));
      await load(userId);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <StaffPageHeader title={t('title')} description={t('description')} />

      <SectionCard title={t('lookupTitle')} description={t('lookupDescription')} columns={1}>
        <form onSubmit={check} className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-medium leading-normal">
            {t('userId')}
            <Input
              value={inputUserId}
              onChange={(event) => changeTarget(event.target.value)}
              placeholder={t('userIdPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={invalidUserId}
              aria-describedby={invalidUserId ? 'mcp-user-id-error' : undefined}
              disabled={saving}
              className="min-w-0"
            />
          </label>
          <Button type="submit" disabled={loading || saving} className="w-full sm:w-auto">
            {loading ? t('checking') : t('check')}
          </Button>
        </form>
        {invalidUserId ? <p id="mcp-user-id-error" role="alert" className="text-sm leading-normal text-destructive-soft-foreground">{t('invalidUserId')}</p> : null}
        {lookupFailed ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 text-sm leading-normal text-destructive-soft-foreground">
            <span>{t('lookupFailed')}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void load(inputUserId.trim())}>{t('retry')}</Button>
          </div>
        ) : null}
      </SectionCard>

      {status ? (
        <SectionCard title={t('statusTitle')} columns={1}>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={status.blocked ? 'danger' : 'neutral'}>{t(status.blocked ? 'blocked' : 'available')}</Badge>
              <span className="min-w-0 break-all text-sm leading-normal text-muted-foreground">{status.userId}</span>
            </div>
            <p className="text-sm leading-normal text-muted-foreground">{t(status.blocked ? 'blockedDescription' : 'availableDescription')}</p>
            {status.blocked && (status.blockedAt || status.reason) ? (
              <dl className="grid min-w-0 gap-3 text-sm leading-normal sm:grid-cols-2">
                {status.blockedAt ? <div><dt className="text-muted-foreground">{t('blockedAt')}</dt><dd className="tabular-nums">{new Date(status.blockedAt).toLocaleString(locale)}</dd></div> : null}
                {status.reason ? <div className="min-w-0"><dt className="text-muted-foreground">{t('reason')}</dt><dd className="break-words">{status.reason}</dd></div> : null}
              </dl>
            ) : null}
            <div>
              <Button type="button" variant={status.blocked ? 'outline' : 'destructive'} onClick={() => { setSaveFailed(false); setPending(status.blocked ? 'unblock' : 'block'); }}>
                {t(status.blocked ? 'unblock' : 'block')}
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <section className="space-y-2 rounded-lg border border-border bg-card p-6" aria-labelledby="mcp-oauth-title">
        <h2 id="mcp-oauth-title" className="text-sm font-medium leading-normal">{t('oauthTitle')}</h2>
        <p className="text-sm leading-normal text-muted-foreground">{t('oauthDescription')}</p>
        <Link href="/account/connected-apps" className="inline-block break-all text-sm font-medium leading-normal underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('connectedApps')} · /account/connected-apps
        </Link>
      </section>

      <p role="status" aria-live="polite" className="min-h-5 text-sm leading-normal text-muted-foreground">{announcement}</p>

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open && !saving) setPending(null); }}>
        <DialogContent closeLabel={t('close')}>
          <DialogHeader>
            <DialogTitle>{t(pending === 'block' ? 'confirmBlockTitle' : 'confirmUnblockTitle')}</DialogTitle>
            <DialogDescription className="break-words leading-normal">
              {t(pending === 'block' ? 'confirmBlockDescription' : 'confirmUnblockDescription', { userId: status?.userId ?? '' })}
            </DialogDescription>
          </DialogHeader>
          {pending === 'block' ? (
            <label className="flex flex-col gap-1.5 text-sm font-medium leading-normal">
              {t('reasonLabel')}
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder={t('reasonPlaceholder')} disabled={saving} />
            </label>
          ) : null}
          {saveFailed ? <p role="alert" className="text-sm leading-normal text-destructive-soft-foreground">{t('saveFailed')}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setPending(null)}>{t('cancel')}</Button>
            <Button type="button" variant={pending === 'block' ? 'destructive' : 'default'} disabled={saving} onClick={() => void save()}>
              {saving ? t('saving') : t(pending === 'block' ? 'block' : 'unblock')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
