'use client';

import {
  ANALYTICS_CONSENT_COOKIE, ANALYTICS_CONSENT_MAX_AGE, ANALYTICS_CONSENT_VERSION,
  readAnalyticsConsent, type AnalyticsConsent,
} from '@/lib/analytics-consent';

const listeners = new Set<(consent: AnalyticsConsent) => void>();
let listening = false;
let channel: BroadcastChannel | undefined;
let deniedForVisit = false;

function storedConsent(): AnalyticsConsent {
  if (typeof document === 'undefined') return 'unknown';
  try { return readAnalyticsConsent(document.cookie); } catch { return 'unknown'; }
}

export function getAnalyticsConsent(): AnalyticsConsent {
  return deniedForVisit ? 'denied' : storedConsent();
}

export function getServerAnalyticsConsent(): AnalyticsConsent { return 'unknown'; }

function notify(consent = getAnalyticsConsent()) { listeners.forEach((listener) => listener(consent)); }
function notifyCurrent() { notify(); }

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  // The cookie is authoritative. Storage and broadcast messages only invalidate readers.
  window.addEventListener('storage', (event) => {
    if (event.key === ANALYTICS_CONSENT_COOKIE && event.newValue) {
      notify(readAnalyticsConsent(`${ANALYTICS_CONSENT_COOKIE}=${event.newValue}`));
    } else if (event.key === ANALYTICS_CONSENT_COOKIE || event.key === null) notify();
  });
  window.addEventListener('focus', notifyCurrent);
  document.addEventListener('visibilitychange', notifyCurrent);
  if (typeof window.BroadcastChannel === 'function') {
    try {
      channel = new window.BroadcastChannel(ANALYTICS_CONSENT_COOKIE);
      channel.addEventListener('message', (event: MessageEvent<unknown>) => {
        notify(event.data === 'denied' ? 'denied' : getAnalyticsConsent());
      });
    } catch { /* Storage/focus synchronization remains available. */ }
  }
}

export function subscribeAnalyticsConsent(listener: (consent: AnalyticsConsent) => void) {
  listen();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Stores only a versioned preference, never a visitor ID. Returns false if cookies are blocked. */
export function setAnalyticsConsent(preference: Exclude<AnalyticsConsent, 'unknown'>): boolean {
  if (typeof document === 'undefined') return false;
  listen();
  // Stop queued requests immediately, including when the browser refuses a cookie write.
  deniedForVisit = true;
  notify();
  const value = `${ANALYTICS_CONSENT_VERSION}.${preference}`;
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${ANALYTICS_CONSENT_COOKIE}=${value}; Path=/; SameSite=Lax; Max-Age=${ANALYTICS_CONSENT_MAX_AGE}${secure}`;
  } catch { /* Readers continue to fail closed. */ }
  const saved = storedConsent() === preference;
  deniedForVisit = !saved;
  notify();
  try {
    // A transient signal only: the bounded cookie is the sole persisted preference.
    window.localStorage.setItem(ANALYTICS_CONSENT_COOKIE, value);
    window.localStorage.removeItem(ANALYTICS_CONSENT_COOKIE);
  } catch { /* Storage may be disabled. */ }
  try { channel?.postMessage(preference); } catch { /* Best effort across tabs. */ }
  return saved;
}
