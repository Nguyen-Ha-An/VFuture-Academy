// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const COOKIE = 'vf_analytics_consent';

describe('consent-gated browser analytics', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.cookie = `${COOKIE}=; Path=/; Max-Age=0`;
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each(['', 'v1.denied', 'v0.granted', 'invalid'])('sends nothing for unknown, denied or stale preference: %s', async (value) => {
    if (value) document.cookie = `${COOKIE}=${value}; Path=/`;
    const { track } = await import('@/lib/analytics-client');
    track('landing.cta_clicked', { cta: 'hero' });
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('batches compatible events only after consent with no referrer or client timestamp', async () => {
    const { setAnalyticsConsent } = await import('@/lib/analytics-consent-client');
    const { track } = await import('@/lib/analytics-client');
    expect(setAnalyticsConsent('granted')).toBe(true);
    track('landing.cta_clicked', { cta: 'hero' });
    track('landing.course_card_clicked', { courseId: 'ai-foundations' });
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/analytics');
    expect(request).toMatchObject({ method: 'POST', keepalive: true, credentials: 'same-origin', referrerPolicy: 'no-referrer' });
    expect(JSON.parse(String(request.body))).toEqual({ events: [
      { name: 'landing.cta_clicked', props: { cta: 'hero' } },
      { name: 'landing.course_card_clicked', props: { courseId: 'ai-foundations' } },
    ] });
  });

  it('never replays activity recorded before consent or after withdrawal', async () => {
    const { setAnalyticsConsent } = await import('@/lib/analytics-consent-client');
    const { track } = await import('@/lib/analytics-client');
    track('landing.cta_clicked', { cta: 'hero' });
    setAnalyticsConsent('granted');
    track('landing.cta_clicked', { cta: 'hero-primary' });
    setAnalyticsConsent('denied');
    setAnalyticsConsent('granted');
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).not.toHaveBeenCalled();
    track('landing.cta_clicked', { cta: 'final-primary' });
    await vi.advanceTimersByTimeAsync(250);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).events).toEqual([
      { name: 'landing.cta_clicked', props: { cta: 'final-primary' } },
    ]);
  });

  it('clears queued events when another tab withdraws consent', async () => {
    document.cookie = `${COOKIE}=v1.granted; Path=/`;
    const { track } = await import('@/lib/analytics-client');
    track('public.page_viewed', { route: 'courses', locale: 'en' });
    document.cookie = `${COOKIE}=v1.denied; Path=/`;
    window.dispatchEvent(new StorageEvent('storage', { key: COOKIE, newValue: 'v1.denied' }));
    document.cookie = `${COOKIE}=v1.granted; Path=/`;
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops old queued events even when another tab rapidly withdraws and grants again', async () => {
    document.cookie = `${COOKIE}=v1.granted; Path=/`;
    const { track } = await import('@/lib/analytics-client');
    track('public.page_viewed', { route: 'home' });
    window.dispatchEvent(new StorageEvent('storage', { key: COOKIE, newValue: 'v1.denied' }));
    window.dispatchEvent(new StorageEvent('storage', { key: COOKIE, newValue: 'v1.granted' }));
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps analytics off for this visit when a browser refuses to save withdrawal', async () => {
    document.cookie = `${COOKIE}=v1.granted; Path=/`;
    const { setAnalyticsConsent, getAnalyticsConsent } = await import('@/lib/analytics-consent-client');
    const { track } = await import('@/lib/analytics-client');
    track('public.page_viewed', { route: 'home' });
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => undefined);
    expect(setAnalyticsConsent('denied')).toBe(false);
    expect(getAnalyticsConsent()).toBe('denied');
    track('public.page_viewed', { route: 'courses' });
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('writes a bounded first-party preference cookie without an identifier', async () => {
    const cookieSetter = vi.spyOn(document, 'cookie', 'set');
    const { setAnalyticsConsent } = await import('@/lib/analytics-consent-client');
    setAnalyticsConsent('granted');
    expect(cookieSetter).toHaveBeenCalledWith('vf_analytics_consent=v1.granted; Path=/; SameSite=Lax; Max-Age=15552000');
    expect(localStorage.getItem(COOKIE)).toBeNull();
  });

  it('rechecks the cookie at flush time even without a cross-tab message', async () => {
    document.cookie = `${COOKIE}=v1.granted; Path=/`;
    const { track } = await import('@/lib/analytics-client');
    track('public.page_viewed', { route: 'home' });
    document.cookie = `${COOKIE}=; Path=/; Max-Age=0`;
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aborts an in-flight request on withdrawal and never retries it', async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const { setAnalyticsConsent } = await import('@/lib/analytics-consent-client');
    const { track } = await import('@/lib/analytics-client');
    setAnalyticsConsent('granted');
    track('public.page_viewed', { route: 'home' });
    await vi.advanceTimersByTimeAsync(201);
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    setAnalyticsConsent('denied');
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('drops server operations, URLs, PII, search text and non-enumerated values', async () => {
    document.cookie = `${COOKIE}=v1.granted; Path=/`;
    const { track } = await import('@/lib/analytics-client');
    track('exam.started', { itemId: 'exam-1' });
    track('public.page_viewed', { route: '/resources?search=email@example.com' });
    track('public.filters_applied', { route: 'resources', search: 'email@example.com' });
    track('public.cta_clicked', { route: 'home', cta: 'email@example.com' });
    track('public.card_clicked', { route: 'courses', catalog: 'courses', itemId: 'https://example.com' });
    track('landing.cta_clicked', { cta: 'hero', userId: 'learner-1' });
    await vi.advanceTimersByTimeAsync(250);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('snapshots event properties and bounds the queue to 50 events', async () => {
    document.cookie = `${COOKIE}=v1.granted; Path=/`;
    const { track } = await import('@/lib/analytics-client');
    const props = { route: 'home' };
    track('public.page_viewed', props);
    props.route = 'private-secret';
    for (let i = 0; i < 100; i++) track('public.page_viewed', { route: 'home' });
    await vi.advanceTimersByTimeAsync(500);
    const events = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).events;
    expect(events).toHaveLength(50);
    expect(events[0].props.route).toBe('home');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
