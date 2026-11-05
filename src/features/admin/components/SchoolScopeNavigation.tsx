'use client';

import { useEffect, useRef, useState, type SyntheticEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CanvasButton, CanvasLink } from '@/features/canvas/ui';
import { scopeKey } from '@/lib/admin-scope';
import { requestNavigation } from '@/lib/navigation-guard';
import type { SchoolNavigation } from '../school-navigation';

function useSchoolNavigation(navigation: SchoolNavigation) {
  const router = useRouter();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function continueToSchool() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(false);
    let leaving = false;
    try {
      if (!(await requestNavigation()) || !mounted.current) return;
      if (navigation.savedScopeKey === scopeKey(navigation.targetScope)) {
        // A different tab may have changed the cookie since render. The GET entry
        // checks it again before redirecting, and never changes it implicitly.
        router.push(navigation.href);
        leaving = true;
        return;
      }
      const query = new URLSearchParams({ actorId: navigation.actorId, scope: scopeKey(navigation.activeScope) });
      const response = await fetch(`/api/v1/${navigation.workspace}/scope?${query}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'content-type': 'application/json',
          'x-vfuture-expected-saved-scope': navigation.savedScopeKey ?? '',
        },
        body: JSON.stringify({ scope: scopeKey(navigation.targetScope) }),
      });
      if (!response.ok) throw new Error('scope_rejected');
      router.push(navigation.destination);
      router.refresh();
      leaving = true;
    } catch {
      setError(true);
    } finally {
      if (!leaving) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }
  return { continueToSchool, pending, error };
}

function ordinaryClick(event: SyntheticEvent<unknown>) {
  if (event.defaultPrevented || ('button' in event && event.button !== 0)) return false;
  return !('metaKey' in event && event.metaKey) && !('ctrlKey' in event && event.ctrlKey)
    && !('shiftKey' in event && event.shiftKey) && !('altKey' in event && event.altKey);
}

export function SchoolScopeLink({ navigation, children, className, current }: {
  navigation: SchoolNavigation;
  children: ReactNode;
  className?: string;
  current?: 'page';
}) {
  const { continueToSchool, pending, error } = useSchoolNavigation(navigation);
  const t = useTranslations('centralAdmin');
  return <>
    <CanvasLink href={navigation.href} className={className} aria-current={current} aria-busy={pending || undefined}
      data-academy-managed-navigation="true" onClick={(event) => {
        if (!ordinaryClick(event)) return;
        event.preventDefault();
        void continueToSchool();
      }}>{children}</CanvasLink>
    {error ? <span role="alert" className="block text-sm text-destructive">{t('scopeError')}</span> : null}
  </>;
}

export function SchoolScopeContinue({ navigation, label }: { navigation: SchoolNavigation; label: string }) {
  const { continueToSchool, pending, error } = useSchoolNavigation(navigation);
  const t = useTranslations('centralAdmin');
  return <div>
    <CanvasButton type="button" disabled={pending} onClick={() => { void continueToSchool(); }}>{label}</CanvasButton>
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{t('scopeError')}</p> : null}
  </div>;
}
