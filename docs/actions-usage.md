# GitHub Actions

The only active workflow is `deploy.yaml`. A `main` push or manual dispatch deploys the exact revision to Academy's separate Vercel project. Repository production-environment secrets are `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`; concurrency is `vfuture-academy-deploy-production`.

Graphify, typecheck, lint, unit/content/schema tests, SQL contracts, production build and browser checks are mandatory local work before merging. Run `npm run graphify:refresh` followed by `npm run verify:local`; GitHub Actions must not execute validation, seed or migration jobs. Database/scheduler operations are independent operator procedures, outside the deployment runner.
