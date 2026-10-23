# Isolated real-runtime browser checks

Verified on 2026-09-09: **30/30 browser cases passed**, ten each in Chromium, Firefox and WebKit. Do not start this suite or Vite while the main student matrix owns4180. The active runner must release the main run first. The original matrix files/config/source were not edited by this addition.

## Run only after port release

From the repository root, minimum requested coverage (10Chromium cases):

```sh
STUDENT_RUNTIME_RUN=runtime-chromium-01 ./node_modules/.bin/playwright test --config playwright.student-runtime.config.ts --project chromium
```

Full reusable engine coverage (30cases):

```sh
STUDENT_RUNTIME_RUN=runtime-all-01 ./node_modules/.bin/playwright test --config playwright.student-runtime.config.ts
```

Each command starts and stops its own Vite server on4180 through the existing read-only `tests/e2e/student-harness/vite.config.ts`. Existing-server reuse is false. Run sequentially, use a fresh run name, and do not start a separate manual server first. Firefox/WebKit launch failures must be reported unavailable, never passing or silently skipped. No install, production build, DB, or Next output is required.

The new config reuses the existing main config's engine definitions but overrides testMatch to `**/runtime.check.ts`. The original `**/*.spec.ts` matrix cannot discover this file, so its114-case list is unchanged. This suite defines5cases ×2 locale/theme combinations ×3engines. Cases use390×900, en/dark and vi/light. `page.emulateMedia` sets colorScheme/reducedMotion; explicit matchMedia assertions verify both. There is no invalid top-level reducedMotion test.use option. Fixed Date time makes savedAt deterministic while real800ms debounce/retry timers continue normally.

Output: `tests/e2e/student-harness/artifacts/<STUDENT_RUNTIME_RUN>/{results,report,results.json}`. Defaults to runtime-latest if no name provided. Do not commit generated assets. Reuse the parent-requested ignore for this artifact directory.

## Implementation boundaries

New files only:

- runtime.html
- src/runtime-main.tsx
- src/runtime-fixture-data.ts
- runtime.check.ts (intentionally not .spec.ts)
- runtime-README.md
- root playwright.student-runtime.config.ts

Imports actual AppShell, ItemPlayer, createApiRuntime (created internally by ItemPlayer), LessonRenderer/Reflection, FocusOutline, LearnerNavigationLink, the shared navigation guard, source messages, and globals.css. No replacement runtime, UI, guard, confirmation, or focus behavior. Reflection's real Save button queues the debounced runtime write; merely typing in this renderer does not enqueue runtime state. This distinction is tested honestly.

The entry URL is `/runtime.html?lang=en` or `?lang=vi`. Entry setup replaces its URL with the source fixture's canonical item route, then actual navigation shim pushes render a destination marker and unmount ItemPlayer. Existing Next navigation aliases are reused read-only. Test-only history instrumentation records pushState destinations without changing behavior; the setup replaceState is not a navigation commit.

Playwright intercepts every `/api/` request locally. Only actual progress viewed POST and response-block PUT are configured. Viewed returns200. Block requests begin503 with a real error envelope; tests switch to held200 only for successful retry. The ledger records actual method/path/payload/status. Every unexpected API or non-GET request gets501 and is asserted as a failure. External requests are blocked and asserted unexpected. No database or real backend request is allowed. The fixture's HTTP callbacks, not runtime mocks, control failures and recovery.

## Cases and exact expectations

1. Failed debounced response write and navigation flush: open actual outline, click DestinationA. Outline must unmount before the only leave dialog appears. Dialog has actual localized accessible title/description, passes unfiltered WCAG axe, and traps keyboard focus. Stay and Escape each close it, restore the outline trigger, preserve response text, and commit no navigation.
2. Leave Anyway: click once in the real dialog. Navigate immediately to the exact original outline href without any later destination click; exactly one history commit and source textarea unmounted.
3. Retry503 then200: first retry fails and remains in dialog with text. Second retry's200 response is held; assert busy button disabled and original text remains. Actual successful request payload must contain original text/completed state/course/item. Release response; exact pending outline href commits once without another click.
4. Rapid different actual LearnerNavigationLinks: hold failed flush while clicking First then Second with browser pointer input. Only the first owns the eventual decision. Leave Anyway commits the exact first query/hash destination once; never the second.
5. Dirty native document navigation: actual anchor triggers browser beforeunload dialog after interaction/queued write. Dismiss it; source URL and text remain, zero SPA commits. No synthetic beforeunload event and no stubbed window.confirm.

Screenshots capture outline-before-navigation, real leave-dialog-after-outline-close, after Stay/Leave, retry-pending text, recovered destination, competing links, and dismissed native unload. Attachments include actual focus element, URL, history commits, media-query state, font availability, backend ledger and axe JSON. Failed tests retain traces/screenshots. No axe exclusions or expected-failure annotations; source defects must be reported to parent rather than fixed here.

## Validation and limits

Static implementation validation only: all four TypeScript/TSX files parsed by esbuild with zero syntax warnings. An in-memory browser bundle resolved2364modules using aliases extracted read-only from the existing Vite config; actual ItemPlayer/api-runtime/Reflection/FocusOutline/LearnerNavigationLink/navigation-guard appeared in the graph, with no server-only module. The four new runtime TypeScript entrypoints and their imported dependencies also passed a no-emit TypeScript check with0diagnostics. No Vite server, browser command, production build, emitted bundle, shared config edit, or source fix was performed. Import graph resolution does not prove browser execution.

Full Next routing/hydration, database persistence, authentication, exam/assignment state machines, response typing before Save, production font rendering and actual next-page data are outside scope. Fonts use platform fallbacks and are recorded after fonts.ready; screenshots are not production typography baselines. The destination is a fixture marker reached by the real navigation decision through the existing browser router shim. Final pass/fail/engine availability counts belong to the parent QA run.
