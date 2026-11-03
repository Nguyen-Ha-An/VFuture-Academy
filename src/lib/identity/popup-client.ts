import { navigateAfterAuth } from '@/lib/post-auth-navigation';
import { routes } from '@/lib/routes';
import { safeInternalPath } from '@/lib/safe-internal-path';
import { isPopupSignal, popupChannelName } from './popup-contract';

export type PopupPhase = 'waiting' | 'verifying' | 'closed';
export type PopupError = 'blocked' | 'cancelled' | 'provider' | 'session' | 'timeout';
export type PopupHandle = { cancel: (notify?: boolean) => void; focus: () => void };
/** Must be called directly in a click handler: opening the window precedes every async step. */
export function startAuthPopup(options: { url: string; next: string; onPhase: (phase: PopupPhase) => void; onError: (error: PopupError) => void }): PopupHandle {
  const attempt = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
  const destination = new URL(options.url, window.location.origin);
  if (destination.origin !== window.location.origin) throw new Error('Authentication popup must start on this origin');
  destination.searchParams.set('popup', '1'); destination.searchParams.set('attempt', attempt);
  let popup: Window | null = null;
  let active = true, verifying = false, reportedClosed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(popupChannelName(attempt));
  const cleanup = () => {
    active = false; controller.abort(); clearInterval(interval); clearTimeout(timeout);
    window.removeEventListener('message', onWindowMessage); channel?.close();
  };
  const close = () => { try { popup?.close(); } catch { /* Provider isolation may sever this reference. */ } };
  const fail = (error: PopupError) => { if (!active) return; cleanup(); close(); options.onError(error); };
  const receive = async (data: unknown) => {
    if (!active || verifying || !isPopupSignal(data, attempt)) return;
    const acknowledgement = { type: 'academy-auth-popup-ack', attempt };
    try { popup?.postMessage(acknowledgement, window.location.origin); } catch { /* COOP may have severed the handle. */ }
    channel?.postMessage(acknowledgement);
    if (data.status === 'error') { fail('provider'); return; }
    verifying = true; options.onPhase('verifying');
    const verificationTimeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/v1/auth/session', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
      const session: unknown = response.ok ? await response.json() : null;
      if (!active) return;
      if (!session || typeof session !== 'object' || !('userId' in session) || typeof session.userId !== 'string' || !session.userId) { fail('session'); return; }
      cleanup(); close();
      navigateAfterAuth(routes.auth.welcome({ next: safeInternalPath(options.next) }));
    } catch { if (active) fail('session'); } finally { clearTimeout(verificationTimeout); }
  };
  function onWindowMessage(event: MessageEvent) {
    if (event.origin === window.location.origin && popup !== null && event.source === popup) void receive(event.data);
  }
  window.addEventListener('message', onWindowMessage);
  if (channel) channel.onmessage = event => {
    // BroadcastChannel is same-origin and its unpredictable channel name is bound
    // to this one server-persisted attempt. It carries no identity or tokens.
    if (event.origin === window.location.origin) void receive(event.data);
  };
  try { popup = window.open(destination.toString(), 'academy-auth-popup', 'popup=yes,width=520,height=720'); } catch { /* Blocked by browser policy. */ }
  if (!popup) fail('blocked');
  else {
    options.onPhase('waiting');
    try { popup.focus(); } catch { /* Focus may be managed by the browser. */ }
    interval = setInterval(() => {
      if (!active || verifying || reportedClosed) return;
      try {
        if (popup?.closed) {
          // COOP can make a still-open provider window appear closed. Keep the
          // attempt-bound channel alive and offer retry rather than trusting it.
          reportedClosed = true; options.onPhase('closed');
        }
      } catch { /* Keep listening for the matching completion channel. */ }
    }, 500);
    timeout = setTimeout(() => fail('timeout'), 600000);
  }
  return { cancel: (notify = true) => { if (!active) return; cleanup(); close(); if (notify) options.onError('cancelled'); }, focus: () => { try { popup?.focus(); } catch { /* No authority depends on focus. */ } } };
}
