# Entrance preview checks

Start a local Academy preview, then run:

```sh
npx playwright test --config tests/e2e/public-site/public.config.ts
```

`PUBLIC_E2E_BASE_URL` defaults to `http://127.0.0.1:3103` and rejects non-loopback targets. The suite checks the shared entrance at mobile and desktop widths, its response headers and legal links, and redirects from retired public catalog URLs. The fixture aborts writes so the checks do not create accounts or send authentication email. Screenshots and traces are saved under the ignored `recovery-evidence/public-refactor/` directory.
