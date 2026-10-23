# Academy acceptance

The standalone repository needs fresh local verification and independent hosted acceptance. Results and deployment receipts from the former monolith are historical and do not count as a new deployment gate. Infrastructure provisioning and data cutover are deferred.

Run `npm run graphify:refresh`, then `npm run verify:local`. It verifies graph freshness, types, lint, all retained unit/content/schema tests, a production build, disposable PostgreSQL contracts and Studio/Admin/student browser harnesses. `--full` includes the broader browser and reviewed visual matrix. Public discovery acceptance has its independent local config in `tests/e2e/public-site/public.config.ts`.

Before a future live cutover, exercise signed-out discovery and private-content exclusion; email/password/Google/recovery Auth; enrollment/progress/completion; quizzes/exams/manual grading/releases; assignments/media/certificate downloads; Studio draft/import/review/publication/version restore; branch/role/member scope; public profile/privacy controls; MCP permission/no-write/refresh/revocation; and the isolated notebook workflow. Validate a separate project's actual RLS/Storage/Auth settings and backup restoration. Preserve explicit failures and unknowns; a source extraction or READY deployment alone is insufficient.
