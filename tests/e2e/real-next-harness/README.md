# Real root Next / native PostgreSQL routing fixture

This is a local-only launcher for the actual root Next application and its middleware, configuration, layouts, pages, API handlers, identity session store, permissions, AzureDataClient and PostgREST transport. It has no alternate page tree, Vite server, data-client alias, mocked application service or unknown-route fallback.

The authoring agent does not execute this harness. The lead owns runtime, checks and acceptance; earlier private positive-flow receipts must not be presented as verification of later source changes.

The preinstalled native PostgreSQL17 binaries must exist. The discovery helper is used only after the explicit binary directory is checked, so its automatic npm-install branch cannot run. PostgREST13.0.7's approved extracted binary SHA256 is `89559e2f1568c8ae2ad5c73519713a1cf9230581213a2a73c094e600279f7761`; the official TAR.XZ archive has the separate SHA256 `c0757fa1e59af142d4a0f0fe5eb2f9815a1098498aa64b54971a16a5757660d7`, verified by the lead. Both are recorded separately; the retained archive is checked again when present.

From the isolated worktree, with no root `.env*` runtime files:

```sh
STUDIO_POSTGRES_BIN=/tmp/academy-routing-native-pg/node_modules/@embedded-postgres/darwin-arm64/native/bin node scripts/fixtures/academy-routing-next.mjs
```

The launcher prints only the ready status, URL, private manifest path and CA path. The manifest and child environment are mode0600 under ignored `build/azure-core/private/routing-next-*`. `DYLD_LIBRARY_PATH` is set only for owned native children. Credentials are synthetic and inherited deployment variables are discarded. Root dotenv files are rejected to prevent Next from loading a live configuration.

| Surface | Fixed local endpoint |
| --- | --- |
| Native PostgreSQL17 | Owned `/tmp/academy-route.*/socket`, database `academy_route_fixture`, socket port55447, TCP disabled |
| PostgREST13.0.7 | HTTP `127.0.0.1:4450`, actual `academy_private.authorize_request` hook |
| Data TLS proxy | `https://localhost:4451` → PostgREST4450 |
| Actual root Next backend | HTTP `127.0.0.1:4454`, public origin configured as localhost4452 |
| App TLS frontend | `https://localhost:4452` → Next4454, including upgrades |

Both TLS proxies use a fresh local CA and leaf certificate with localhost/127.0.0.1 SANs. Only the Next child receives `NODE_EXTRA_CA_CERTS`; the HTTP driver supplies that CA explicitly. The server and HTTP driver keep TLS verification enabled; no global trust-store change is required. Mutation Origin headers are preserved. The Next instance's public hostname/port is configured for the reverse proxy rather than rewriting request Origin to bypass the actual API guard.

The current complete53migration Azure schema is applied to the disposable database, including the upload/answer boundary migration; it never skips that migration or substitutes the historical through52 forward baseline. Seed generation calls the real content compiler on all13 canonical question types, publishes the normal course/version/outline/item/render rows, and stores grading separately from public summaries. Synthetic actors are `owner` (central admin), `learner`, `other`, `suspended` (school membership suspended after enrollment), and `expired` (expired server session). Session cookies are random43character handles; only SHA256 hashes enter `academy_identity.sessions`. Valid session/token lifetimes are8h/4h and no refresh token is seeded.

Run the actual HTTP sequence using the printed manifest path:

```sh
node tests/e2e/real-next-harness/flow.mjs /absolute/path/to/manifest.json
```

It checks session identity, an authenticated profile update through real RLS transport, actual SSR course text/CSP, start/save/clear/submit/review, matching edges, grouped child keys, an allowed upload link, long text, wrong-owner/suspended-membership/expired-session errors and SQL-controlled admission retry. It writes a private `http-flow-result.json`. Every endpoint and direct fixture-control DB connection is constrained to the local manifest. A fresh fixture is needed to repeat the same lifecycle sequence.

For production-cookie/SSR mode, the lead can start `--production --data-only` to keep real local PostgreSQL/PostgREST/TLS available while building the actual root application with the recorded synthetic `next-env.json` after source freeze. The launcher does not build implicitly. Stop that fixture after the build, then restart with `--production` for the full root production server and fresh session handles. The real cookie name becomes `__Host-academy_session` with Secure/HttpOnly/Path=/. Browser use requires an owned test profile trusting the local fixture CA or a browser process pinned to the exact synthetic leaf certificate public key. A process-specific SPKI exception is limited to that fixture key; never use a blanket certificate-error bypass or change the user’s OS trust store. The launcher does not configure browser trust.

`route-inventory.mjs` emits all current root page/API source entries and configured staff aliases. Its records are explicitly unexecuted source inventory. The earlier85entry routing ledger is a scoped subset; neither file existence nor HTTP200 is called render coverage. Concrete dynamic IDs, actor/locale/theme/state, browser content/console evidence and alias execution must be recorded separately.

Boundaries: external Entra sign-in/provisioning is not emulated or established. The local server-side session store, active-account guard and permissions are real. `storage-fixture.mjs` supplies a bounded local simulator of the external Storage protocol, including signed uploads and downloads. File-browser scenarios exercise actual owned reservation, finalization, authorization and database paths against those simulated bytes; they do not establish hosted Storage behavior or capacity. The basic HTTP sequence alone does not establish file-byte coverage. Nothing uses production credentials, UUIDs, origins or database state.

## Network guard and negative route census

The Next test process installs `fetch-guard.mjs` before preparing the actual application. It rejects and records every global fetch outside `https://localhost:4451`, `https://localhost:4452` and `http://127.0.0.1:4454`; it does not fabricate responses. Native fetch automatic redirect following is refused so a local redirect cannot escape the guard. Explicit manual redirects remain manual. The private `outbound-fetch.jsonl` contains method/origin/path/outcome metadata, without query strings, bodies, tokens or credential values. This is a global-fetch guard, not a claim to intercept arbitrary native socket libraries. Both PostgreSQL and the Next child run with server timezone UTC.

The legacy environment placeholders required by unconditional client import point only to the local TLS data proxy. Storage construction uses a fresh synthetic service key accepted only by the local simulator. Neither establishes external identity or hosted Storage behavior.

After restarting the fixture so the guard is installed, the lead can run:

```sh
node tests/e2e/real-next-harness/probe-backend.mjs /absolute/path/to/manifest.json docs/design/canvas-refinement/backend-route-audit.json
```

The authoritative source audit supplies the current method/path pairs; use its recorded count and source hashes rather than an earlier census count. Requests carry no authentication cookies, bearer credentials or cron secret; mutation bodies are only `{}`. Dynamic paths use the synthetic manifest or missing fixture IDs. The driver uses the fixture CA, preserves Origin and never follows redirects. It records status/code and distinguishes JSON validation/auth/policy/feature/data rejection, protocol responses, unvalidated success, ambiguous HTML404, server errors and transport errors. Source pointers, callers, contracts and SQL references resolve through the audit's evidence catalog; source hashes reveal drift. No original source-audit disposition is upgraded. Even a successful unauthenticated response is explicitly **not** successful business verification. Invalid unauthenticated requests can still produce local side effects, so only this disposable fixture is admitted.

Partial results survive in `backend-rejection-probes.jsonl`; the complete report is `backend-rejection-probes.json`. Exit1 means observations require adjudication, not a verdict that every reported rejection is a product bug. HTML404 may be a handler's intentional `notFound`, rather than proof of an unregistered route.

## Actual production SSR cold/warm browser helper

The lead first starts the production-shaped root fixture with server timezone UTC and an owned browser configured with fixture-specific trust as described above. The helper itself does not launch the browser or alter certificate trust. Connect only to that browser's explicit loopback CDP endpoint:

```sh
ACADEMY_ROUTING_BROWSER_CDP_URL=http://127.0.0.1:4460 ACADEMY_ROUTING_TRUSTED_BROWSER=1 node tests/e2e/real-next-harness/ssr-browser.mjs /absolute/path/to/production-manifest.json
```

The helper creates isolated synthetic-cookie contexts for EN/VI, browser timezone Asia/Ho_Chi_Minh, and learner dashboard/course plus owner Studio course-list routes. Each context gets a cold document navigation and a warm reload. A rejecting local proxy blocks non-loopback browser egress without mocking responses or disabling HTTP cache. The helper closes its contexts/proxy and disconnects without closing the lead-owned browser.

Evidence comes from the **actual navigation document response**, SSR main/h1, document hashes/native IDs, locale/timezone, real native Account open/close/focus interaction and all console/page/hydration errors. Only actor/locale/timezone metadata is retained for profiles; no rendered profile body, real names, session values or screenshots are saved. Fresh browser context does not mean process-cold Next. `production-ssr-browser.jsonl/json` records every case and failure. A `#418` or ID mismatch remains a failure requiring a source baseline/comparison; nothing sets `ssr:false`, suppresses hydration warnings, forces IDs or treats a warm-only success as a cold fix.

## Explicit synthetic dense-dashboard variant

The default launcher/seed still creates the original one-item course. The observed-shape variant is an explicit local data preparation, not another route, UI, or API implementation:

```sh
node tests/e2e/real-next-harness/dense-dashboard.mjs /absolute/path/to/production-manifest.json
ACADEMY_ROUTING_BROWSER_CDP_URL=http://127.0.0.1:4460 ACADEMY_ROUTING_TRUSTED_BROWSER=1 node tests/e2e/real-next-harness/ssr-browser.mjs /absolute/path/to/production-manifest.json --dense-dashboard
```

Preparation requires the unchanged synthetic owner baseline in the socket-only fixture database. It compiles and publishes a separate synthetic course through actual `compileCourse`:39 paragraph-only lessons,8 standalone assignments and2 exams,49 items total with10 tasks and no embedded assessment activities. It retains the existing central-admin role, gives that fixture owner an explicitly synthetic long role-suffixed name, drops only that owner's original active enrollment and enrolls it in the dense course. Other actors' original enrollments/course remain unchanged for the existing positive HTTP flow. Existing owner results are rejected rather than deleted; no results or announcements are invented. Preparation is once per disposable fixture.

The private manifest receives an additive `denseProfile`; the original course/item/answers/actors fields keep their meanings. The preparation receipt retains only counts, checksums and the synthetic profile-name length/hash. Dense SSR mode rechecks the actual native database with a read-only transaction, then runs **only4cases**:central-admin-as-learner `/app`, EN/VI × cold/warm. It asserts all3 staff rail entries, the long greeting, one active49-item course,10 actual task rows, empty results and no announcements, alongside unchanged production SSR/hydration/error/focus/TLS checks. Its separate `production-ssr-dense-dashboard.jsonl/json` outputs do not overwrite or repeat the12case baseline. No private user/course content is copied into this fixture.

## Explicit same-course upgrade and historical-file proof

On a disposable fixture where the actual `file-browser.mjs` exam upload has completed and submitted, the lead may run once:

```sh
node tests/e2e/real-next-harness/history-upgrade.mjs /absolute/path/to/manifest.json
```

This is an explicit state-changing local proof, not default launcher behavior. It selects the terminal synthetic learner attempt and READY attachment bound by the file browser, matching filename/root-question/checksum/size evidence. Strict native socket/database/actor/course guards remain in force. It compiles a valid V2 of the same base course using actual `compileCourse`, with the old exam removed and one new paragraph lesson. Local SQL publishes only new V2 source/grading/renders/outline plus the course's current-publication pointer. V1 source, outline, items, renders, attempt, answers and attachment bindings are not rewritten.

Enrollment moves only through the actual owner-central authenticated `POST /api/v1/studio/courses/:courseId/enrollments/migrate`, not through a fixture pin edit. That existing API has no confirmation token or body and operates on **all eligible active enrollments for the selected course**. Its guarded RPC locks each enrollment and rejects missing completed-progress items/conflicts. The helper records every migrated/skipped count and reason, requires the learner in the actual migrated list, verifies V2 enrollment and unchanged original branch scope, and never deletes progress to force migration. Unexpected old learner lesson-progress or an already-created V2 aborts this once-per-fixture proof.

After migration it requires current-old-item JSON API404, current-new-lesson200, dedicated pinned historical-review200 with the submitted file reference, owner historical-media200 with unchanged file hash, authorized-grader ordinary-media200 with the same bytes, unrelated-owner404, and bound READY finalize replay200 returning the original asset. Dedicated historical-media query is owner-only by contract; grading authority uses the ordinary media route and the immutable original attempt school. Full hashes of V1/history/bindings and total attempt/binding/reservation/asset counts must remain unchanged, including after replay. No new attempt or binding is fabricated.

Only status/code, counts, byte hashes, opaque-ID hashes and immutable-row hashes are written to private `history-upgrade-result.json` / `history-upgrade-observations.json`; no answer values or tokenized URLs are retained. `--record-manifest` optionally adds a metadata-only `historyUpgrade` receipt pointer and V1/V2 item identifiers; it is off by default and leaves original manifest base fields unchanged. This reuses the existing bounded local external-Storage simulator, not hosted Storage. Start a fresh fixture before repeating this upgrade or the original positive flow.
