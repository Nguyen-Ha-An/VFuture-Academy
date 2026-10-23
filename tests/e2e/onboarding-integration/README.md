# Next.js onboarding integration

Run from the repository root:

```sh
npm exec playwright test -- --config playwright.onboarding-integration.config.ts
```

The runner creates and removes a temporary Next.js application that imports the real login form, callback, welcome page, onboarding server action, session middleware, learner layout and dashboard. It supplies the existing next-intl request configuration and runs the installed Next.js version. The source application and its `.next` directory are not replaced.

A loopback-only Auth/PostgREST fixture provides a fresh Google-provider user and empty learner data. The browser uses the real Supabase browser/SSR clients: the local provider validates that a PKCE challenge and verifier are present, returns a session, and the real callback/action/dashboard consume cookie-backed identity. This fixture **does not authenticate with Google or validate hosted Supabase configuration, cryptographic verification, or deployed RLS**. All profile writes and fixture resets are local test data. No real credentials are supplied.

The tests verify callback → onboarding → actual rendered authenticated dashboard, query preservation, single profile write, completed-onboarding revisit, duplicate-handle retry with preserved inputs, and native form completion/retry with browser JavaScript disabled. The separate Vite suite covers the larger UI error/pending/mobile/locale matrix.

Ports 3191 and 3192 must be free; the runner never reuses an existing server. Traces and screenshots are retained on failure under the repository's ignored `test-results/onboarding-integration` directory.
