# Isolated student browser acceptance

Verified on 2026-09-09: the main matrix passed 114/114 cases; the separate real-runtime suite passed 30/30 across all three engines; four reviewed Darwin visual references passed comparison without updates.

The harness renders actual student components with deterministic service fixtures. It does not validate hosted authentication, database persistence, Next SSR/hydration, or exact production typography. Screenshots use platform fallback fonts, recorded in their evidence. The production build and worker CSP check are separate gates.

Use loopback port **4180** serially. No Next output, production build, database or secrets are needed. Do not overlap the suites or another server on the same port.

## Routine QA commands

Run from the repository root. Each invocation owns its Vite server, starts 4180, and stops it on completion. Do not run these commands concurrently or start a manual Vite server first. Existing-server reuse is deliberately disabled.

```sh
STUDENT_HARNESS_RUN=matrix-01 ./node_modules/.bin/playwright test --config playwright.student.config.ts
```

This is **114 tests**: 38 per Chromium/Firefox/WebKit. Each engine has 12 locale/theme/width combinations (en/vi × light/dark system color scheme × 390/768/1440, height900), each with three tests, plus two StatusNotice theme tests. Reduced motion is enabled in all combinations. No missing engine is skipped or counted as passing. If an executable/dependency is missing, report it as unavailable; do not install shared dependencies without parent coordination.

For a focused source-fix retest:

```sh
STUDENT_HARNESS_RUN=account-fix-02 ./node_modules/.bin/playwright test --config playwright.student.config.ts --project chromium --grep '(en light 1440|en dark 390).*account'
```

For one engine, if needed after an engine-specific failure, use a new run name:

```sh
STUDENT_HARNESS_RUN=firefox-02 ./node_modules/.bin/playwright test --config playwright.student.config.ts --project firefox
```

Change the run name each time to preserve results. Output is `artifacts/<run>/{results,report,results.json}`. Tests attach axe JSON, raw row geometry, font availability, screenshots and failure traces. Original evidence is preserved under `artifacts/initial-diagnosis/` and `artifacts/account-diagnosis/`. Do not commit any artifacts or `.cache`; both paths are excluded by root `.gitignore`.

Manual inspection only, while no QA runner owns 4180:

```sh
./node_modules/.bin/vite --config tests/e2e/student-harness/vite.config.ts
```

Then visit `http://127.0.0.1:4180/app?lang=en` or `?lang=vi`. Emulate system dark mode (a query parameter alone does not activate real source CSS dark tokens).

## Real source coverage and fixtures

Imports the actual AppShell, LearnerAccountActions, shared shell/menu primitives, FocusOutline, QuizRenderer, registered content/choice renderers, both profile settings components, all four StatusNotice tones, messages and globals.css. Fourteen actual route variants: dashboard, learning/discovery catalog, course overview, Explore, profile, resource list/detail, opportunity list/detail, project list/detail, and global/branch leaderboards. `/app/notices` and the item route are fixture compositions of real components, not production page imports.

Fixtures replace auth, learner summary/rewards, catalog service, profile service, resource service/context and server intl. Server intl uses the real next-intl translator and real messages. Catalog has one active course and one discoverable course; resource discovery has one reading; profile has XP, a completed course, empty certificates/skills/projects. Resource and opportunity filter schemas are browser-safe replicas of the current service shapes, and project statuses match the current service enumeration. Real list-context normalizers are imported unchanged. These replicas enable rendering only; normalization unit tests use the real schemas and remain authoritative. An unexpected database property access throws. Requests outside localhost4180 are blocked; unconfigured `/api/` calls receive501. Signout alone is intercepted as a successful fixture HTML navigation, preserving the actual form's action/method/submit behavior and local signout marker. No auth session is ended.

Next Link/navigation are browser shims for client history changes. They do not implement focus restoration or target focus; actual source components own that behavior. They are not Next routing/hydration acceptance.

## Assertions and evidence

- Fourteen route variants: visible main heading, no horizontal document overflow, unfiltered WCAG2A/AA/2.1AA/2.2AA axe violations, no uncaught page errors. Direct initial and changed profile hash focus.
- Desktop account: eight real menu rows, vertically non-overlapping, >=44px targets with at most0.1px numeric epsilon (e.g. browser animation math returned43.999969px for44). Raw values are attached; genuine sub44 layout must not be accepted. Surface stays in viewport and computes animation:none under reduce.
- Mobile drawer: Escape closes/restores trigger; resize to 760 closes and restores visible focus (the bench nav and account menu show from 760px). Open surface is audited with axe.
- Actual account links: first-route certificates, same-profile XP, repeated same hash; heading receives focus after menu/drawer close; Escape still restores trigger. Native signout form ownership, POST request, fixture destination and localStorage signal.
- Real outline: open/axe/screenshot/Escape/focus. Real quiz selects an answer; first check throws, real renderer shows localized alert and retains checked answer; retry succeeds with the same answer and exactly two fixture calls. Screenshots before check, after failure, after retry.
- Real StatusNotice neutral/success/warning/error: both themes, axe and screenshots.

Soft assertions keep source defects visible while allowing later assertions and evidence collection. There are no expected-failure annotations, axe exclusions, CSS overrides, or mocked UI replacements for covered components.

## Known limits

Google Fonts are not fetched. Screenshots use platform fallback sans-serif/monospace and are **not exact production typography baselines**. Each screenshot waits for fonts.ready and attaches loaded faces and declared body family. Real colors/layout rules remain unchanged.

No production DB/auth/API acceptance; no Next SSR/hydration/middleware or production asset/build check. No ItemPlayer pending-save confirmation, full lesson/exam/assignment/notebook runtime, enrollment mutation, profile mutation/upload, persistence tests. The quiz uses a deterministic local runtime, not API runtime. Both locales localize real UI; fixture content stays fixed English. No no-preference motion matrix. Browser engines other than Chromium were not executed by the implementation worker; the parent routine QA worker owns their validation.

## Initial diagnosis

Initial Chromium eight-test sample: six passed, two navigation tests failed. Page geometry/axe passed at en/light1440 and en/dark390; outline+quiz passed at both; StatusNotice passed in both themes. Parent was sent reduced-motion CSS specificity defect (expected none, actual learner-surface-in; mobile initialy=-4px). Parent subsequently corrected source CSS.

Enhanced account run: desktop completed cross-route/same-profile/repeated-hash focus, Escape and native POST signout, but open menu axe reported serious aria-hidden-focus on hidden root with tabbable descendants. Mobile passed first-route certificates and resize closure/visible focus but XP focus sequence failed. All failures retained and sent to parent; do not relabel as passes. See sourcefix-check results for the focused run after CSS correction, then run the final routine matrix after parent fixes.

## Frozen QA handoff

Harness frozen after parent reported the final nonmodal-account/inert-mobile-root/same-hash source fixes and translation integration. No new source edits or matrix execution by implementation worker after this handoff.

Latest `sourcefix-check` ran two Chromium account cases: both failed before those final fixes. Desktop completed both XP attempts with heading focus and native signout; axe still reported hidden-root tabbables. Mobile diagnostic `hash-focus-attempt-1` shows XP h2 active; attempt2 shows the Open menu button active, confirming repeated-same-hash restoration. This run also still reported `animationName:learner-surface-in`; routine QA must verify fresh source/CSS and report any remaining reduce-motion failure, not assume it passed from source inspection. Artifacts are preserved. Latest final parent fixes are UNVERIFIED by this worker.

Execution accounting: initial8 distinct Chromium cases (6passed/2failed), then two focused2-case account reruns (2failed each). These reruns are not additional distinct coverage. All114 matrix cases are discovered; Firefox/WebKit and remaining locale/width combinations are UNRUN here. The parent routine worker should run `STUDENT_HARNESS_RUN=matrix-01 ...` above and report exact passed/failed/unavailable counts without expected-failure suppression.


## Final page-family expansion (current frozen coverage)

The existing `real pages geometry and axe` case now loops over these exact routes, still within the original114-test topology:

```text
/app
/app/courses
/app/courses?tab=discover
/app/courses/ai-basics
/app/explore
/app/profile
/app/resources
/app/resources/fixture-resource?type=reading&tag=systems&page=1
/app/opportunities?type=workshop&openNow=true&featured=true&page=1
/app/opportunities/fixture-opportunity?type=workshop&openNow=true&featured=true&page=1
/app/projects?status=active&skill=systems&course=ai-basics
/app/projects/fixture-project?status=active&skill=systems&course=ai-basics
/app/leaderboard
/app/leaderboard?scope=branch
```

All are actual current page imports. Detail calls receive searchParams; Back-link pathname and normalized query context are asserted. Actual StaticRichContent, opportunity action/view tracker, project interest/proposal components and leaderboard table remain in the tree. Service fixtures mock IO and return current response shapes (resource/opportunity pageSize50, detail bodies, attachments, courseStatuses, project members/outputs/related courses and leaderboard rows). Resource/opportunity schema replicas import actual browser-safe enums and preserve current strict bounds; they are not replacements for production schema unit coverage. Fixture list filtering supports the sampled data, not complete service business-rule acceptance.

New IO aliases: projects/service, opportunities/service, me/service and xp/service. The existing resources service mock now exposes get and the full current localized resource shape; ecosystem context supplies branchId. The real Next Image module remains imported; the harness supplies its normally injected `__NEXT_IMAGE_OPTS` constant as undefined so Next uses defaults. Fixture project covers are null, so image/media loading itself is not covered. Opportunity view analytics POST is intercepted locally with the production202empty response; other unconfigured APIs still receive501. No production source or runtime-validated files were changed.

One permitted focused smoke was run:

```sh
STUDENT_HARNESS_RUN=page-family-smoke ./node_modules/.bin/playwright test --config playwright.student.config.ts --project chromium --grep 'en light 1440.*real pages geometry and axe'
```

Result: **1passed**, containing all14route visits, all14axe audits, geometry, detail Back-context assertions, profile hash focus and14page-family screenshots. Duration10seconds total. Evidence: `artifacts/page-family-smoke/{results,report,results.json}`. Actual screenshot for every family is saved under `results/student-en-light-1440-real-pages-geometry-and-axe-chromium/page-family-*.png`; the project detail screenshot was also visually inspected. Expanded other locale/theme/width/engine combinations remain for parent QA. No full matrix, typecheck or production build was run in this final expansion; parent owns those after freeze. Static browser import resolution succeeded with2459modules and no server-only inputs.

Parent-reported prior runtime result:30/30passed; runtime files/config were preserved. Earlier reduced-motion diagnoses above are historical: parent subsequently found the invalid top-level Playwright option and corrected main tests to contextOptions. Current assertions must use that corrected browser state.

## Separate four-case visual regression suite

`visual.check.ts` and root `playwright.student-visual.config.ts` define **four Chromium-only** cases: English light/dark ×1440/390. They do not match the main *.spec.ts topology or runtime.check.ts. Each keyboard-opens the real account menu/drawer, verifies deterministic focus and actual reduced-motion media state, then uses a **locator** screenshot (only that surface), animations disabled, maxDiffPixelRatio0.01. Color scheme and reduction use proper Playwright options.

Snapshots resolve to:

```text
tests/e2e/student-harness/snapshots/chromium/darwin/account-en-light-1440.png
tests/e2e/student-harness/snapshots/chromium/darwin/account-en-dark-1440.png
tests/e2e/student-harness/snapshots/chromium/darwin/account-en-light-390.png
tests/e2e/student-harness/snapshots/chromium/darwin/account-en-dark-390.png
```

Template: `{testDir}/snapshots/{projectName}/{platform}/{arg}{ext}`. Other platforms use their own directories; missing baselines fail explicitly because default updateSnapshots is none. No fallback to darwin files and no skip-on-missing behavior. CI is parent-owned and intended for macos-latest matching these darwin baselines. **No visual tests or baseline generation were run by this worker.**

After4180is free, parent QA may generate the initial four on macOS:

```sh
STUDENT_VISUAL_RUN=visual-initial-01 ./node_modules/.bin/playwright test --config playwright.student-visual.config.ts --update-snapshots=all
```

Parent must review all four before accepting/committing those baseline images. Generating them is not regression acceptance. After review, compare without updates:

```sh
STUDENT_VISUAL_RUN=visual-compare-01 ./node_modules/.bin/playwright test --config playwright.student-visual.config.ts
```

Use fresh run names; reports/results are under artifacts/<run>. No CI files were changed. Platform fallback fonts remain an explicit limitation; these are stable harness-surface baselines, not exact production typography. Font availability is attached to each visual case. Browser/package/font/OS changes may require reviewed baseline updates, never automatic acceptance.
