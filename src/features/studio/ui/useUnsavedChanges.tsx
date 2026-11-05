"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { registerNavigationGuard, type NavigationIntent } from '@/lib/navigation-guard';
import { Button, Dialog, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/classic';

type Pending = { resolve: (allow: boolean) => void; intent?: NavigationIntent; returnFocus: HTMLElement | null };
const INDEX = '__studioHistoryIndex';
type TraverseEvent = Event & { navigationType: string; destination: { key: string; sameDocument: boolean } };
type BrowserNavigation = EventTarget & { traverseTo: (key: string) => { finished: Promise<unknown> } };

export function useUnsavedChanges(dirty: boolean, save: () => Promise<boolean>) {
  const t = useTranslations('studioWorkspace');
  const router = useRouter();
  const latest = useRef({ dirty, save });
  latest.current = { dirty, save };
  const pendingRef = useRef<Pending | null>(null);
  const closingDecision = useRef<boolean | null>(null);
  const approvedDocument = useRef<AbortSignal | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const requestLeave = useCallback(async (intent?: NavigationIntent): Promise<boolean> => {
    if (!latest.current.dirty) return true;
    if (pendingRef.current) return false;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise(resolve => { pendingRef.current = { resolve, intent, returnFocus }; closingDecision.current = null; setSaveFailed(false); setOpen(true); });
  }, []);
  const settle = useCallback((allow: boolean) => {
    closingDecision.current = allow;
    setOpen(false);
  }, []);
  const finishClose = useCallback((event: Event) => {
    // This controlled dialog has no Dialog.Trigger. Radix's default would
    // prevent generic focus restoration and try its empty trigger ref.
    event.preventDefault();
    const pending = pendingRef.current;
    if (!pending) return;
    const allow = closingDecision.current === true;
    pendingRef.current = null;
    closingDecision.current = null;
    const visible = (element: HTMLElement | null): element is HTMLElement => {
      if (!element?.isConnected || element === element.ownerDocument.body || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      return style?.display !== 'none' && style?.visibility !== 'hidden' && style?.opacity !== '0' && element.getClientRects().length > 0;
    };
    const fallback = document.querySelector<HTMLElement>('main h1[tabindex="-1"]') ?? document.querySelector<HTMLElement>('main[tabindex="-1"]');
    const target = visible(pending.returnFocus) ? pending.returnFocus : visible(fallback) ? fallback : null;
    target?.focus({ preventScroll: true });
    if (allow && pending?.intent?.kind === 'document' && !pending.intent.signal.aborted) approvedDocument.current = pending.intent.signal;
    pending?.resolve(allow);
  }, []);
  useEffect(() => registerNavigationGuard(requestLeave), [requestLeave]);
  useEffect(() => {
    let bypassUnload = false;
    let bypassPop = false;
    let restoring = false;
    let nativeBypass = false;
    const navigation = (window as unknown as { navigation?: BrowserNavigation }).navigation;
    let index = typeof history.state?.[INDEX] === 'number' ? history.state[INDEX] as number : 0;
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;
    const replace = (data: unknown, unused: string, url?: string | URL | null) => originalReplace.call(history, { ...(data as object), [INDEX]: index }, unused, url);
    const push = (data: unknown, unused: string, url?: string | URL | null) => { index += 1; originalPush.call(history, { ...(data as object), [INDEX]: index }, unused, url); };
    originalReplace.call(history, { ...history.state, [INDEX]: index }, '', location.href);
    history.pushState = push;
    history.replaceState = replace;
    const unload = (event: BeforeUnloadEvent) => {
      if (latest.current.dirty && !bypassUnload && !(approvedDocument.current && !approvedDocument.current.aborted)) { event.preventDefault(); event.returnValue = ''; }
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const destination = new URL(anchor.href, location.href);
      // The shared account Tray closes its focus region before requesting these same guards.
      if (destination.origin === location.origin && anchor.dataset.academyManagedNavigation === 'true') return;
      if (!['http:', 'https:'].includes(destination.protocol)) return;
      if (destination.pathname === location.pathname && destination.search === location.search) return;
      if (!latest.current.dirty) return;
      event.preventDefault(); event.stopPropagation();
      void requestLeave().then(allow => {
        if (!allow) return;
        bypassUnload = true;
        if (destination.origin === location.origin) router.push(destination.pathname + destination.search + destination.hash);
        else location.assign(destination.href);
      });
    };
    const submit = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !latest.current.dirty || bypassUnload) return;
      // Only navigation forms (signout), not dialogs with React submit handlers.
      if (!form.getAttribute('action')) return;
      event.preventDefault(); event.stopPropagation();
      void requestLeave().then(allow => { if (allow) { bypassUnload = true; form.requestSubmit(event.submitter instanceof HTMLElement ? event.submitter : undefined); } });
    };
    const pop = (event: PopStateEvent) => {
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      const nextIndex = typeof event.state?.[INDEX] === 'number' ? event.state[INDEX] as number : index - 1;
      if (bypassPop || !latest.current.dirty) { bypassPop = false; index = nextIndex; return; }
      const delta = nextIndex - index;
      if (!delta) return;
      event.stopImmediatePropagation();
      restoring = true;
      history.go(-delta);
      void requestLeave().then(allow => {
        if (allow) { bypassPop = true; bypassUnload = true; history.go(delta); }
      });
    };
    const navigate = (rawEvent: Event) => {
      const event = rawEvent as TraverseEvent;
      if (event.navigationType !== 'traverse' || !event.destination.sameDocument || !event.cancelable) return;
      if (nativeBypass) { nativeBypass = false; bypassPop = true; return; }
      if (!latest.current.dirty) return;
      event.preventDefault();
      void requestLeave().then(allow => {
        if (!allow || !navigation) return;
        nativeBypass = true;
        void navigation.traverseTo(event.destination.key).finished.catch(() => { nativeBypass = false; bypassPop = false; });
      });
    };
    document.addEventListener('click', click, true);
    document.addEventListener('submit', submit, true);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('popstate', pop, true);
    navigation?.addEventListener('navigate', navigate);
    return () => {
      document.removeEventListener('click', click, true);
      document.removeEventListener('submit', submit, true);
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('popstate', pop, true);
      navigation?.removeEventListener('navigate', navigate);
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    };
  }, [requestLeave, router]);
  const dialog = <Dialog open={open} onOpenChange={value => { if (!value && !saving) settle(false); }}><DialogPortal>
    <DialogOverlay className="fixed inset-0 z-[80] bg-black/40" />
    <DialogContent className="fixed left-1/2 top-1/2 z-[81] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-xl" onCloseAutoFocus={finishClose} onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}>
      <DialogTitle className="text-lg font-semibold">{t('leaveTitle')}</DialogTitle>
      <DialogDescription className="mt-2 text-sm text-muted-foreground">{t('leaveDescription')}</DialogDescription>
      {saveFailed ? <p role="alert" className="mt-3 text-sm text-destructive">{t('saveFailed')}</p> : null}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button disabled={saving} onClick={() => settle(false)} className="bg-secondary text-secondary-foreground hover:bg-accent">{t('stay')}</Button>
        <Button disabled={saving} onClick={() => settle(true)} className="bg-secondary text-secondary-foreground hover:bg-accent">{t('discard')}</Button>
        <Button disabled={saving} onClick={() => { setSaving(true); setSaveFailed(false); void latest.current.save().then(ok => { if (ok) settle(true); else setSaveFailed(true); }).catch(() => setSaveFailed(true)).finally(() => setSaving(false)); }}>{t(saving ? 'saving' : 'save')}</Button>
      </div>
    </DialogContent>
  </DialogPortal></Dialog>;
  return { requestLeave, dialog };
}
