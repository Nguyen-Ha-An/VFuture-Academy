'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { WorkspaceTheme } from '@/features/workspace-ui/theme';
import { WorkspaceSurface } from '@/features/workspace-ui/ui/WorkspaceSurface';
import { connectedAppsCopy, type ConnectedAppsLocale } from './copy';
import '@/features/workspace-ui/learner/learner.css';

export type ConnectedApp = {
  clientId: string;
  name: string;
  scopes: string[];
  grantedAt: string;
};

export type ConnectedAppsState = { kind: 'ready'; apps: ConnectedApp[] } | { kind: 'unavailable' };

export function ConnectedAppsPanel({ state, accountEmail, locale, theme }: {
  state: ConnectedAppsState;
  accountEmail: string;
  locale: ConnectedAppsLocale;
  theme: WorkspaceTheme;
}) {
  const t = connectedAppsCopy[locale];
  const [apps, setApps] = useState(state.kind === 'ready' ? state.apps : []);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dates = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'medium' });

  async function remove(clientId: string) {
    if (busyId || confirmId !== clientId) return;
    setBusyId(clientId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/v1/account/oauth-grants', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      if (!response.ok) {
        setError(response.status === 429 ? t.rateLimited : t.failed);
        return;
      }
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || !('data' in payload)
        || !payload.data || typeof payload.data !== 'object'
        || !('revoked' in payload.data) || payload.data.revoked !== true) {
        setError(t.failed);
        return;
      }
      setApps((current) => current.filter((app) => app.clientId !== clientId));
      setConfirmId(null);
      setNotice(t.removed);
    } catch {
      setError(t.failed);
    } finally {
      setBusyId(null);
    }
  }

  return <WorkspaceSurface theme={theme} className="vf-learner-refined">
    <a href="#connected-apps-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-10 focus:flex focus:min-h-11 focus:items-center focus:bg-card focus:px-4 focus:py-2">{locale === 'vi' ? 'Bỏ qua điều hướng' : 'Skip to content'}</a>
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <Link href="/" className="inline-flex min-h-11 items-center font-medium text-foreground">{t.brand}</Link>
        <form action="/auth/signout" method="post"><button className="min-h-11 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted" type="submit">{t.signOut}</button></form>
      </div>
    </header>
    <main id="connected-apps-main" className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
      <div className="vf-page-head">
        <p className="vf-kicker">{t.account}</p>
        <h1 className="vf-title">{t.title}</h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{t.description}</p>
        <p className="break-all text-sm text-muted-foreground">{t.signedInAs} <span className="font-medium text-foreground">{accountEmail}</span></p>
      </div>

      <section className="vf-block" aria-labelledby="connected-apps-list-title">
        <h2 id="connected-apps-list-title" className="vf-title-sm mb-5">{t.listTitle}</h2>
        {notice ? <p role="status" className="mb-5 rounded-md border border-border bg-card p-4 text-sm leading-relaxed">{notice}</p> : null}
        {error ? <p role="alert" className="mb-5 rounded-md border border-destructive bg-card p-4 text-sm leading-relaxed text-destructive">{error}</p> : null}
        {state.kind === 'unavailable' ? <p role="alert" className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{t.unavailable}</p>
          : apps.length === 0 ? <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{t.empty}</p>
            : <ul className="divide-y divide-border rounded-lg border border-border bg-card" aria-label={t.listTitle}>
              {apps.map((app) => <li key={app.clientId} className="min-w-0 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="break-words text-xl font-medium leading-snug">{app.name}</h3>
                    <p className="vf-meta mt-1 break-all">{app.clientId}</p>
                    <p className="mt-3 text-sm text-muted-foreground">{t.granted}: {dates.format(new Date(app.grantedAt))}</p>
                  </div>
                  {confirmId !== app.clientId ? <button type="button" className="min-h-11 rounded-md border border-destructive px-4 text-sm font-medium text-destructive hover:bg-muted" onClick={() => { setConfirmId(app.clientId); setError(null); }} disabled={busyId !== null} aria-label={`${t.disconnect} ${app.name}`}>{t.disconnect}</button> : null}
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium">{t.scopes}</p>
                  <ul className="mt-2 flex flex-wrap gap-2">{app.scopes.map((scope) => <li key={scope} className="max-w-full break-all rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs leading-normal">{scope}</li>)}</ul>
                </div>
                {confirmId === app.clientId ? <div className="mt-5 border-t border-border pt-5">
                  <p className="font-medium">{t.confirmTitle} {app.name}?</p>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{t.confirmDescription}</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" className="min-h-11 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted" disabled={busyId !== null} onClick={() => setConfirmId(null)}>{t.cancel}</button>
                    <button type="button" className="min-h-11 rounded-md border border-destructive px-4 text-sm font-medium text-destructive hover:bg-muted disabled:opacity-60" disabled={busyId !== null} aria-busy={busyId === app.clientId || undefined} onClick={() => void remove(app.clientId)}>{busyId === app.clientId ? t.working : t.remove}</button>
                  </div>
                </div> : null}
              </li>)}
            </ul>}
      </section>
    </main>
  </WorkspaceSurface>;
}
