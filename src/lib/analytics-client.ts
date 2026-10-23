"use client";

import {
  isBrowserAnalyticsEvent, MAX_ANALYTICS_BATCH_SIZE, MAX_ANALYTICS_BODY_BYTES,
  type AnalyticsProps, type BrowserAnalyticsEvent, type PublicAnalyticsEventName, type PublicAnalyticsEvents,
} from '@/lib/analytics-contract';
import { getAnalyticsConsent, subscribeAnalyticsConsent } from '@/lib/analytics-consent-client';

const FLUSH_DELAY_MS = 200;
const queue: BrowserAnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
const inFlight = new Set<AbortController>();
let subscribed = false;

function discard() {
  queue.length = 0;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  inFlight.forEach((controller) => controller.abort());
  inFlight.clear();
}

function ensureConsentSubscription() {
  if (subscribed) return;
  subscribed = true;
  subscribeAnalyticsConsent((consent) => {
    if (consent !== 'granted' || getAnalyticsConsent() !== 'granted') discard();
  });
}

async function flush() {
  flushTimer = undefined;
  if (getAnalyticsConsent() !== 'granted') { discard(); return; }
  const events: BrowserAnalyticsEvent[] = [];
  while (queue.length > 0 && events.length < MAX_ANALYTICS_BATCH_SIZE) {
    const candidate = queue[0];
    if (new TextEncoder().encode(JSON.stringify({ events: [...events, candidate] })).byteLength > MAX_ANALYTICS_BODY_BYTES) break;
    events.push(queue.shift()!);
  }
  if (events.length === 0) return;

  const controller = new AbortController();
  inFlight.add(controller);
  try {
    await fetch("/api/v1/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
  } catch {
    // Analytics is deliberately best-effort and must never block navigation.
  } finally {
    inFlight.delete(controller);
  }

  if (getAnalyticsConsent() !== 'granted') { discard(); return; }
  if (queue.length > 0) flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
}

export function track(name: string, props: AnalyticsProps = {}) {
  if (typeof window === 'undefined') return;
  ensureConsentSubscription();
  if (getAnalyticsConsent() !== 'granted') { discard(); return; }
  if (!isBrowserAnalyticsEvent(name, props)) return;
  // Bound memory even while the network is slow. Never persist or replay dropped events.
  if (queue.length >= MAX_ANALYTICS_BATCH_SIZE) return;
  queue.push({ name, props: { ...props } });
  flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
}

export function trackPublic<Name extends PublicAnalyticsEventName>(name: Name, props: PublicAnalyticsEvents[Name]) {
  track(name, props);
}
