# Backend route audit

`backend-route-audit.json` inventories **195 current explicit HTTP method/path exports in 163 route files** at `bc61984` plus the in-flight working tree. It covers GET 91, POST 71, PUT 18, PATCH 7, DELETE 7 and OPTIONS 1. Framework-generated HEAD/OPTIONS behavior is outside this explicit-source count. Aliases and deliberately rejected MCP GET/DELETE exports have their own rows.

This audit performed source reads and static parsing only. It did not start an application, contact production, run tests, build, install dependencies or open a browser. Route-file SHA256 values identify the source read; later source edits require a refresh. Static traversal is bounded to three direct identifier/import hops. Object-interface dispatch and factory methods are not invented as runtime edges.

## Reading a row

Each `routes[]` entry has `method`, `path`, `routeSource`, `implementation` and any `aliasOf`, followed by:

- `productionConsumers`: HTTP, runtime, form, media, background or protocol caller references. A URL builder with an unresolved method says so. Documented protocol consumers are distinguished from owned UI calls.
- `directServerServiceConsumers`: production imports/calls of the same owning service. These do **not** call the HTTP endpoint.
- `sharedImplementationConsumers`: callers of another alias that shares the handler. This does **not** establish execution of both URLs.
- `requestValidation`: route/first-hop parsing and schema references; separately noted higher-order protocol parsers. Missing static matches are explicit review gaps.
- `responseValidation`: serialization and selected client acknowledgement checks. `ok(data)`, generic TypeScript types and casts are not runtime output schemas.
- `serviceAndRepository`: direct route calls, bounded static units, persistence cues, SQL definition references and manually identified exam repository RPCs. Factory-wide persistence cues are candidates, not claimed per-method queries.
- `authorizationScopeOwnerAndPin`: source guard references and `sourceContracts` covering actor, branch, owner, enrollment-version, review revision and snapshot boundaries. Historical migration definitions do not prove an applied database policy.
- `existingTests` and `evidence`: direct handler tests, route references or service tests remain source references unless a separate execution receipt is identified.

Long repeated source excerpts are held once in `sourceEvidenceCatalog`; row reference strings are keys into that object. Every catalog entry retains its source file and one-based line.

## Evidence limits

Current dispositions are **166 source-only, 15 positive-local and 14 external-blocked**. The supplied193-method rejection census is diagnostic because its source hashes/scope differ from final195; it is recorded separately, never promoted to positive behavior. No final current-source negative-only acceptance is claimed, so the primary `negative-only` count remains zero.

Six initial positive-local rows point to the already-existing disposable actual-Next/PostgreSQL/PostgREST HTTP-flow receipt: session GET, own-profile PATCH, exam start, answer save/clear, submit and review. Only sanitized receipt observations are copied; session values, identifiers and answers are omitted. That receipt does not establish the exact current source revision after subsequent edits, production persistence, external sign-in/provisioning, raw Storage bytes, capacity or migration53 security acceptance.

Root's reported read-only production page GETs are recorded separately. They do not become API method proof. The reported production answer PUT400 is retained only as a rejected observation; it is not successful save evidence. No production request was made by this worker.

The 14 external-blocked rows identify identity/customer-account operations or real object/file transfer boundaries for which the existing exam-core receipt supplies no external outcome. Metadata-only media GET/PUT and the intentionally retired multipart endpoint are source-only instead. Local negative admission probes can be attached later without being promoted to positive behavior.

## Caller gaps

`unknownCallerPairs` lists all **69** method/path pairs with no resolved direct production HTTP caller. Of these, 37 have direct production consumers of the same service, and 6 share an implementation consumed through another alias; these categories can overlap. The list also includes documented compatibility/rejection exports. It is a review queue, not a dead-code finding.

Examples needing distinction are public/read APIs whose pages call services directly, administrative aliases used through `/studio`, retired per-item draft/import routes superseded by atomic workspace saves, direct publication APIs superseded in the UI by pinned reviews, the cron GET compatibility alias, public schema protocol endpoints and the retired learner multipart endpoint. Remaining unresolved references are left explicit.

Two method/path pairs have no identified handler/module/service test reference in the source scan. That count measures discovered references, not test completeness or pass status. Positive acceptance still needs concrete actor, seeded IDs, valid/invalid request shapes, response semantics, permissions, SQL effects and current-source receipts for each required flow.

The owning release workflow must refresh Graphify, check its manifest and run the full local verifier after all source/document edits. This inventory is not a merge or deployment approval.

## Historical-review expansion

All three owner-only historical-review GETs have explicit rows: exam attempts, assignment submissions and quiz attempts. Their real SSR pages call services directly; no owned production HTTP caller was resolved. The supplied DEV history receipt now supplies bounded positive-local transport evidence for exam history only; assignment/quiz historical transport remains source-only. `pendingRouteChanges` is now empty and the current source count is195. The earlier baseline census did not cover all three methods. The supplied193-method diagnostic census still does not cover final195; the final source-consistent production census is now recorded below. The school entry page adds no API method.

## Current contract and receipt refresh

`currentRouteContract` is a fresh method-local source parse for all195 API exports, including current SHA256 values. The previous bounded source-evidence catalog remains a navigation aid; in-flight feature edits can invalidate its older line positions. Current source contracts explicitly distinguish:

- Compact answer acknowledgement negotiated with `x-academy-exam-ack: compact-v1`: only submitted keyed answers are acknowledged, with strict client count/key/value checks. Legacy callers retain the full redacted answer-record list.
- The64KiB keyed-map/250-key request bounds and whole-parent grouping, without inventing a whole-exam aggregate cap. Five exam method pairs now serialize finite UTF8 response streams in16KiB chunks. Serialization still materializes the full JSON/byte array; this is not database row streaming or capacity proof.
- Dedicated owner-only immutable historical review and saved-scope/revision/review409 invariants. UI Stay with zero requests does not establish a positive HTTP409 or signout result.

Nine additional method pairs have bounded DEV positive-local cases from the supplied file/practice/history receipts, making15 total positive-local method pairs. These cover77-byte exam/quiz PDF bindings, owner download hashes and unrelated-user privacy, eight renderer check cases without formal attempt creation, actual course-wide V1-to-V2 migration of four local enrollments, current removed/new item behavior and dedicated old exam history/READY replay. Receipt projections retain statuses, counts and hashes only. The file/history storage transport is a bounded local simulator; hosted Storage and external sign-in remain unproven. V2 publication was fixture preparation in the native database, not proof of the authoring publication API.

The193 diagnostic API census contains guard/validation/disabled/data-not-found responses and six unvalidated JSON200 responses; none is relabelled positive business behavior. The final195-method production census, scoped production flows, byte-budget/compact-streaming and actual Studio409 receipts are now recorded in `finalLocalClosure`. Preparation-only receipts remain preparation evidence; they are not assessment execution proof.

## Backend routes outside `/api`

`non-api-route-audit.json` adds seven explicit methods outside `src/app/api`: GET `/auth/login`, GET `/auth/callback`, GET `/auth/recovery`, POST `/auth/signout`, GET `/social/[section]`, and GETs `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/api/mcp`. Each has caller, input/protocol validation, identity/service/SQL or fixed-image boundaries, existing test references and explicit evidence disposition. Two external login/callback methods are external-blocked; recovery, signout, fixed social image and both MCP discovery aliases remain source-only without fresh HTTP receipts.

The full explicit `src/app/**/route.ts` inventory therefore contains **202 method/path pairs across170 route files:195 API methods plus7 non-API methods**. The API195 count must never be presented as the total backend count. Framework-generated implicit HEAD/OPTIONS and convention-generated routes are outside this explicit source-export inventory. No authentication or product source was edited for this audit.

The non-API enumeration explicitly includes hidden `.well-known` directories. An independent whole-app filesystem enumeration caught these two discovery exports; default visible-file search alone is not the coverage source.


## Final local production receipts

`finalLocalClosure` records hashes and specific observations for the disposable actual-root production runtime `routing-next-OaI8Y1`. All195 API exports were probed with matching route hashes; responses were161 auth/policy rejections,15 validation/client rejections,7 data/feature-not-found responses,5 disabled rejections,6 unvalidated JSON successes and1 unvalidated protocol/non-JSON success. No500, transport failure or unregistered HTML404 occurred. This is a rejection/registration census, not positive business coverage. The earlier193 census remains historical.

Separate bounded positive flows passed for actual renderer exam/quiz upload and byte download, answer partial/clear shapes, explicit Finish practice, held-upload commit ordering, unknown-submit reconciliation, immutable history after a real guarded enrollment upgrade, Studio409/retry and guarded navigation/scope switching. Production SSR passed12baseline,4editor and4synthetic dual-role/dense cases; the held actual SQL-stream test had zero console/page/hydration errors. The local200-parent budget case saved5,039,666bytes in101bounded batches, streamed session/legacy acknowledgement/review responses above5MB and accepted a10,122,793byte finalization RPC. Hosted capacity is unverified. Final history migration moved3eligible enrollments with0skipped and preserved immutable hashes; this is separate from the earlier4-enrollment DEV run.

Per-method15positive-local/166source-only/14external-blocked labels are deliberately unchanged rather than broadly promoted by these aggregate receipts. See `closure-evidence.md` for exact scope, synthetic rate-bucket case isolation, expected direct-BODY Next registry insertion, and remaining hosted boundaries. Migration53 remains local/unapplied; no production write, release or merge was performed.
