# Onboarding browser regression lane

Run from the repository root with existing dependencies and installed Chromium:

```sh
ONBOARDING_HARNESS_RUN=local ./node_modules/.bin/playwright test --config playwright.onboarding.config.ts
```

The dedicated config starts Vite on `127.0.0.1:4184`, refuses to reuse another server, runs one worker with no retries, and writes JSON, HTML, screenshots, and failure traces to `artifacts/local/`. Omit `ONBOARDING_HARNESS_RUN` to use `artifacts/` directly. No application environment, global auth setup, credentials, account creation, database mutation, or dependency installation is needed. The local `.gitignore` excludes outputs and the Vite cache.

## What runs

The real `WelcomeForm`, React 19 form actions, `useActionState`, shared Input/Button, global CSS, safe destination helper, and English/Vietnamese message files run in a browser with the real `NextIntlClientProvider`. The only application module replaced is `@/features/auth/onboarding-actions`; the ordinary `@` alias just resolves the repository source tree. Production code has no test hooks.

Each of the nine scenarios runs in English and Vietnamese on Desktop Chrome (1280×720) and Pixel 5 Chromium emulation (393×851), for 36 cases:

- Successful submit performs a new document request, leaves welcome, and renders destination content.
- Duplicate handle keeps both entered values, exposes the translated error, focuses the handle, and permits a corrected successful retry.
- Profile update and profile load failures each preserve input and permit retry.
- A held fixture response keeps the translated pending button and both inputs disabled, marks the form busy, and prevents extra submits from pointer/keyboard input. Releasing the response restores retryability.
- A safe deep link retains its full path, query, and fragment in submitted form data and the resulting document URL.
- An absolute external URL, protocol-relative URL, and welcome loop each submit the sanitized `/app` destination and navigate locally.

Unexpected browser exceptions and console errors fail tests. Browser network routing blocks all non-harness origins. Pending and duplicate-error screenshots are captured on both projects/locales even on passing runs.

## Fixture controls and limits

Tests intercept the local `POST /__onboarding/submit` request. Its payload is the real submitted `{handle, displayName, next}`. The replacement action returns recoverable state from the fixture response; success calls `window.location.assign(safeInternalPath(next))` and leaves the action pending until the document unloads. The pending test explicitly holds/releases a request instead of waiting an arbitrary duration.

Destination content is deliberately labeled a local fixture. This lane proves browser form state, translations, submitted data, and actual document navigation under the action simulation. It does **not** execute the production server action, Next's redirect protocol or router cache, real destination pages, middleware, Google OAuth, Supabase cookies/session refresh, RLS, persistence, or database concurrency. The fixture's use of the real path helper is not evidence that the server action enforces it; the assertions on submitted `next` additionally verify the real form sanitizes it. Production action checks and the parent's separate Next integration lane cover other boundaries.

## Old-form regression evidence

During implementation, an unmodified snapshot of the old form was loaded through a disposable Vite transform outside the repository. Only that temporary baseline supplied a fixed local user ID and fake public Supabase configuration; a browser route fulfilled a local profile request with duplicate code `23505`. The translated duplicate error rendered, then both value-preservation assertions failed: `future_builder` and `Nguyễn An` became empty strings. This is a reproduced value-loss regression, **not** a reproduction or root-cause claim about the user's persisted-save navigation symptom.

Baseline scripts, exact commands, trace/screenshot paths, and final verification are recorded in `/tmp/vfuture-google-onboarding/browser-report.md`. None of the baseline substitutions are present in the reusable lane.
