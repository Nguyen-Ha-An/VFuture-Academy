import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

test('production preview lab performance sample', async ({ browser, baseURL }, testInfo) => {
  test.skip(!process.env.PUBLIC_PERF_PHASE, 'Explicitly opt in with PUBLIC_PERF_PHASE=before or after.');
  test.setTimeout(120_000);
  const { isolatePublicContext } = await import('./fixtures');
  const samples = [];
  const paths = ['/', '/academy', '/courses', '/projects', '/opportunities', '/resources'].filter(path => !process.env.PUBLIC_PERF_ROUTES || process.env.PUBLIC_PERF_ROUTES.split(',').includes(path));
  for (const pathname of paths) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
    await isolatePublicContext(context);
    await context.addInitScript(() => {
      const metrics = { lcp: null as number | null, cls: 0, shifts: [] as unknown[], fontEvents: [] as unknown[] };
      document.fonts.addEventListener('loading', () => metrics.fontEvents.push({ type: 'loading', time: performance.now() }));
      document.fonts.addEventListener('loadingdone', () => metrics.fontEvents.push({ type: 'loadingdone', time: performance.now() }));
      Object.assign(window, { __publicLabMetrics: metrics });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) metrics.lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> })[]) {
          if (!entry.hadRecentInput) metrics.cls += entry.value;
          metrics.shifts.push({ time: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput, sources: entry.sources.map(source => {
            const node = source.node instanceof Element ? source.node : source.node?.parentElement;
            return { tag: node?.tagName, id: node?.id, class: node?.getAttribute('class'), text: node?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 140), previousRect: source.previousRect.toJSON(), currentRect: source.currentRect.toJSON(), parent: node?.parentElement?.tagName + '.' + node?.parentElement?.className };
          }) });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    const page = await context.newPage();
    const response = await page.goto(`${baseURL}${pathname}?lang=en`, { waitUntil: 'load' });
    expect(response?.status()).toBe(200);
    await expect(page.locator('main')).toBeVisible();
    // Fixed post-load observation window, identical before/after; not a readiness sleep.
    await page.waitForTimeout(2500);
    const sample = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const metrics = (window as unknown as { __publicLabMetrics: { lcp: number | null; cls: number; shifts: unknown[]; fontEvents: unknown[] } }).__publicLabMetrics;
      return {
        ttfbMs: navigation.responseStart - navigation.requestStart,
        domContentLoadedMs: navigation.domContentLoadedEventEnd,
        loadMs: navigation.loadEventEnd,
        lcpMs: metrics.lcp,
        observedLayoutShift: metrics.cls,
        layoutShifts: metrics.shifts,
        fontEvents: metrics.fontEvents,
        paintEntries: performance.getEntriesByType('paint').map(entry => ({ name: entry.name, time: entry.startTime })),
        resourceCount: resources.length,
        resourceTransferBytes: resources.reduce((sum, entry) => sum + entry.transferSize, 0),
        resourceEncodedBodyBytes: resources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        scriptTransferBytes: resources.filter((entry) => entry.initiatorType === 'script').reduce((sum, entry) => sum + entry.transferSize, 0),
      };
    });
    samples.push({ pathname, ...sample });
    await context.close();
  }
  const report = {
    phase: process.env.PUBLIC_PERF_PHASE,
    capturedAt: new Date().toISOString(),
    concurrentWork: process.env.PUBLIC_PERF_CONCURRENT_WORK ?? 'none reported',
    methodology: 'Single cold browser context per route, local production preview, Chromium desktop 1440×900, unthrottled CPU/network, normal motion, 2500ms post-load observation. Analytics POSTs intercepted; all other writes blocked. Lab evidence only; no field INP or field CWV claim. Transfer values may be zero for cross-origin resources without Timing-Allow-Origin.',
    samples,
  };
  await mkdir('recovery-evidence/public-refactor', { recursive: true });
  const path = `recovery-evidence/public-refactor/performance-${process.env.PUBLIC_PERF_PHASE}.json`;
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach('lab-performance', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  if (process.env.PUBLIC_PERF_MAX_SHIFT) {
    const budget = Number(process.env.PUBLIC_PERF_MAX_SHIFT);
    expect(Number.isFinite(budget) && budget >= 0, 'PUBLIC_PERF_MAX_SHIFT must be a nonnegative number').toBe(true);
    for (const sample of samples) expect(sample.observedLayoutShift, `${sample.pathname}: bounded lab layout-shift budget`).toBeLessThanOrEqual(budget);
  }
});
