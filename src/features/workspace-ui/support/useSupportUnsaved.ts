'use client';

import { useEffect } from 'react';
import { registerNavigationGuard } from '@/lib/navigation-guard';

/** Protect unpublished form edits on document exit, ordinary links and the shell navigation guard.
 * Same-document history uses the Navigation API when the browser supports cancellation. */
export function useSupportUnsaved(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return;
    const leave = () => window.confirm(message);
    let approvedDocument: AbortSignal | null = null;
    const unregister = registerNavigationGuard(async intent => {
      const allowed = leave();
      if (allowed && intent?.kind === 'document' && !intent.signal.aborted) approvedDocument = intent.signal;
      return allowed;
    });
    const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => {
      const traversal = event as Event & { navigationType?: string; destination?: { sameDocument?: boolean } };
      if (traversal.navigationType === 'traverse' && traversal.destination?.sameDocument && event.cancelable && !leave()) event.preventDefault();
    };
    navigation?.addEventListener('navigate', navigate);
    const unload = (event: BeforeUnloadEvent) => { if (approvedDocument && !approvedDocument.aborted) return; event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const destination = new URL(anchor.href, window.location.href);
      // The shared account Tray closes its focus region before requesting these same guards.
      if (destination.origin === location.origin && anchor.dataset.academyManagedNavigation === 'true') return;
      // External navigation is covered by beforeunload without a second confirmation.
      if (destination.origin !== location.origin) return;
      if (destination.pathname === location.pathname && destination.search === location.search) return;
      if (!leave()) { event.preventDefault(); event.stopPropagation(); }
    };
    const submit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.getAttribute('action')) return;
      if (!leave()) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('submit', submit, true);
    document.addEventListener('click', click, true);
    return () => { navigation?.removeEventListener('navigate', navigate); unregister(); document.removeEventListener('submit', submit, true); window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty, message]);
}
