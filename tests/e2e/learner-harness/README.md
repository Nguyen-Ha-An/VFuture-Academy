# Student presentation browser tests

Run `npx playwright test --config playwright.learner.config.ts` from the repository root. The configuration starts a local Vite server on port 4176 and needs no environment file, database, credentials, migrations, or seeds.

The fixture imports the real student shell, dashboard, catalog, course overview, item-page layout, outline, Explore, loading fallback, styles, and English/Vietnamese messages. It replaces server data/auth functions with deterministic records and Next navigation with browser history. ItemPlayer is deliberately replaced by long static content: these tests check navigation/layout, not lesson completion, exams, submissions, notebooks, authentication, or the Next server. Those behaviors remain covered by their existing component/service tests and separately guarded hosted acceptance.

The completed course fixture includes an unfinished optional item to exercise the distinction between Review and Continue. Every browser context is disposable. Screenshots and failure traces are written to the ignored Playwright output directory.

CI runs this suite alongside the existing staff fixtures. The hosted E2E pause remains unchanged.
