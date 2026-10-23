# Isolated public preview checks

Start a **local production build** separately, then run:

```sh
npx playwright test --config tests/e2e/public-site/public.config.ts
PUBLIC_PERF_PHASE=after PUBLIC_PERF_MAX_SHIFT=0.1 npx playwright test --config tests/e2e/public-site/public.config.ts performance.spec.ts
```

`PUBLIC_E2E_BASE_URL` defaults to `http://127.0.0.1:3103` and rejects non-loopback targets. This config does not import the default Playwright config, run a global setup, reset learners, seed the database, sign up, or send auth email. Its automatic context fixture fulfills analytics POSTs locally and aborts every other non-read request. Additional no-JavaScript and performance contexts install the same interception.

Browser traces/screenshots and performance JSON use `recovery-evidence/public-refactor/`, which survives `verify:local` clearing `test-results`. The directory is gitignored; preserve the run artifacts locally when reviewing.

Public detail browser coverage follows a published local course when available. An empty catalog is annotated rather than fabricated or seeded. Deterministic server-page fixtures in `tests/features/public-discovery-pages.test.tsx` and `tests/features/marketing-course-page.test.tsx` assert detail context, attachments/media, public related-course projection, unavailable application actions, and exact protected handoffs independently of local data. `tests/features/public-site/navigation.test.tsx` verifies form/history/focus behavior without a database.

Performance samples use one cold Chromium context per route, desktop 1440×900, normal motion, unthrottled local CPU/network, and a fixed 2500 ms post-load observation. They record navigation timing, observed LCP/layout shifts, and resource byte totals. They are reproducible **lab observations**, not field Core Web Vitals or INP measurements; compare them under the same machine/server conditions. A single sample is not a statistical regression gate.

The existing dedicated Labs suite retains detailed homepage WebGL, pinning, rail, keyboard and responsive regression coverage. Its normal contexts reject optional analytics to remove consent from motion geometry checks; the public suite tests unknown/granted/denied/withdrawal/cross-tab states explicitly.

Readiness checks wait for the shared loading boundary to disappear before asserting final document landmarks. The no-JavaScript test intentionally applies the same requirement: server-rendered public content must be readable without executing Next's streamed-boundary replacement scripts.

For source attribution, performance captures also record LayoutShift source selectors/text, previous/current rectangles, paint timing and font loading events. `PUBLIC_PERF_ROUTES=/,/academy,/projects,/resources` can restrict a diagnostic sample to known public routes. Set `PUBLIC_PERF_MAX_SHIFT=0.1` to explicitly enforce the agreed bounded lab layout-shift budget; artifacts are written before budget assertions. Without this option a successful performance test means the capture completed, not that a numeric performance target was met.
