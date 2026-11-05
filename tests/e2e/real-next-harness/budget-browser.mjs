// Opt-in real UI + real HTTP client + native PG measurement. No DTO/handler/service substitution.
import { chromium } from '@playwright/test';
import { request as httpsRequest } from 'node:https';
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createStudioFixtureClient } from '../../../scripts/lib/studio-postgres-fixture.mjs';
import { assertBudgetDatabase, budgetDefaults, budgetManifest, digest, requireBudget as check } from './budget-seed.mjs';

const manifest = budgetManifest(resolve(process.argv[2]));
check(manifest.mode === 'production', 'BUDGET_PRODUCTION_FIXTURE_REQUIRED');
const endpoint = new URL(process.env.ACADEMY_ROUTING_BROWSER_CDP_URL ?? '');
check(['http:', 'https:'].includes(endpoint.protocol) && ['127.0.0.1', 'localhost'].includes(endpoint.hostname)
  && endpoint.port && !endpoint.username && !endpoint.password && process.env.ACADEMY_ROUTING_TRUSTED_BROWSER === '1', 'BUDGET_TRUSTED_LOCAL_BROWSER');
const fixture = manifest.budgetFixture, actor = manifest.actors.other;
const ca = readFileSync(manifest.ca);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const copy = JSON.parse(readFileSync(join(repository, 'src/messages/en.json'), 'utf8')).exam;
const startPath = `/api/v1/exams/${fixture.itemId}/attempts`;
const threshold = 4.5 * 1024 * 1024; // A measured lower-bound case, never an asserted aggregate maximum.
const keyedLimit = 64 * 1024, keyLimit = 250;
const stable = value => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const answerHash = value => digest(stable(value) ?? '[absent-answer]');
const nativeRequests = [], browserRequests = [], browserResponses = [], observerTasks = [];
let phase = 'setup', attemptId, blockedRequests = 0, pageErrors = 0, observerErrors = 0;
let heldFirst = false, releasedFirst = false, releaseFirst;
const firstSaveBarrier = new Promise(resolveBarrier => { releaseFirst = resolveBarrier; });
const receipt = { kind: 'actual-root-exam-byte-budget', passed: false, stages: [],
  boundaries: ['Synthetic other actor and new compiled course only; default fixtures/enrollments must remain unchanged',
    'Transport barrier delays the first real request, then forwards it unchanged except Accept-Encoding: identity',
    'All DTOs come from actual HTTPS handlers; subsequent batches use the bundled production client and batcher',
    'Only counts, hashes, statuses and timing metadata are retained; no answers, session values or browser traces',
    'Proxy wireBytes measure response entity bytes with identity encoding, excluding HTTP/TLS framing overhead',
    'The response lower-bound case is not a production aggregate cap; hosted capacity is not proven'] };
const proxyFile = join(manifest.runtime, 'exam-transport.jsonl');
const outboundFile = manifest.outboundFetchLog ?? join(manifest.runtime, 'outbound-fetch.jsonl');
check(existsSync(proxyFile) && existsSync(outboundFile), 'BUDGET_INSTRUMENTATION_REQUIRED');
const proxyOffset = statSync(proxyFile).size, outboundOffset = statSync(outboundFile).size;
const tail = (file, offset) => readFileSync(file).subarray(offset).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
const db = createStudioFixtureClient(manifest.postgres);
let context, exitCode = 1;

function ownPath(url) {
  check(url.origin === manifest.appOrigin && !url.username && !url.password && !url.hash, 'BUDGET_HTTP_ORIGIN');
  if (url.pathname === startPath) return;
  check(attemptId && url.pathname.startsWith(`/api/v1/exams/attempts/${attemptId}/`)
    && /\/(?:answers|submit|review|events)$/.test(url.pathname), 'BUDGET_HTTP_ATTEMPT_SCOPE');
}
function requestMetadata(body, compact) {
  const parsed = JSON.parse(body), answers = parsed.answers;
  check(answers && typeof answers === 'object' && !Array.isArray(answers), 'BUDGET_ANSWER_MAP');
  const keys = Object.keys(answers), keyedBytes = Buffer.byteLength(JSON.stringify(answers));
  check(keys.length <= keyLimit && keyedBytes <= keyedLimit, 'BUDGET_KEYED_REQUEST_BOUND');
  return { keyedBytes, rootCount: keys.length, requestBodyBytes: Buffer.byteLength(body), bodySha256: digest(body), compact };
}
async function poll(predicate, code, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(done => setTimeout(done, 100)); }
  check(false, code);
}
async function storedAnswers() {
  const rows = (await db.query('select a.question_id,a.answer from public.exam_answers a join public.exam_attempts t on t.id=a.attempt_id where t.id=$1 and t.user_id=$2 and t.course_version_id=$3 and t.item_id=$4',
    [attemptId, actor.userId, fixture.versionId, fixture.itemId])).rows;
  return Object.fromEntries(rows.map(row => [row.question_id, row.answer]));
}
/** A real HTTPS adapter for the actual production client; returned bytes are never manufactured. */
async function actualFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, manifest.appOrigin);
  ownPath(url);
  const method = String(init.method ?? 'GET').toUpperCase();
  check(['GET', 'PUT', 'POST'].includes(method), 'BUDGET_HTTP_METHOD');
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const body = typeof init.body === 'string' ? init.body : undefined;
  const meta = method === 'PUT' ? requestMetadata(body, headers['x-academy-exam-ack'] === 'compact-v1') : {};
  const started = performance.now();
  return new Promise((resolveResponse, reject) => {
    const request = httpsRequest(url, { method, family: 4, ca,
      headers: { ...headers, cookie: `${actor.cookie.name}=${actor.cookie.value}; locale=en`,
        'accept-encoding': 'identity', ...(['GET'].includes(method) ? {} : { origin: manifest.appOrigin }) } }, response => {
      const chunks = []; let responseBytes = 0;
      response.on('data', chunk => { chunks.push(chunk); responseBytes += chunk.length; });
      response.on('error', reject);
      response.on('end', () => {
        try {
          check(!response.headers['content-encoding'] || response.headers['content-encoding'] === 'identity', 'BUDGET_IDENTITY_ENCODING');
          const bytes = Buffer.concat(chunks);
          nativeRequests.push({ phase, method, kind: url.pathname === startPath ? 'session' : url.pathname.split('/').at(-1),
            ...meta, status: response.statusCode, responseBytes, responseSha256: digest(bytes), elapsedMs: performance.now() - started });
          resolveResponse(new Response(bytes, { status: response.statusCode, headers: response.headers }));
        } catch (error) { reject(error); }
      });
    });
    const abort = () => request.destroy(Object.assign(new Error('BUDGET_HTTP_ABORT'), { code: 'BUDGET_HTTP_ABORT' }));
    init.signal?.addEventListener('abort', abort, { once: true });
    request.once('close', () => init.signal?.removeEventListener('abort', abort));
    request.on('error', reject); request.setTimeout(120_000, abort);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

try {
  await db.connect(); await assertBudgetDatabase(db, manifest);
  const originalDefaults = await budgetDefaults(db, manifest);
  check(digest(JSON.stringify(originalDefaults)) === fixture.baselineEnrollmentSha256, 'BUDGET_BASELINE_DRIFT');
  const previous = await db.query('select count(*)::int n from public.exam_attempts where user_id=$1 and course_version_id=$2 and item_id=$3', [actor.userId, fixture.versionId, fixture.itemId]);
  check(previous.rows[0].n === 0, 'BUDGET_FRESH_ATTEMPT_REQUIRED');
  const clientBundle = join(manifest.runtime, 'budget-actual-client.mjs');
  await build({ stdin: { contents: `export {createHttpExamClient} from ${JSON.stringify(join(repository, 'src/features/exams/ui/client.ts'))};\nexport {answerBatches} from ${JSON.stringify(join(repository, 'src/features/exams/ui/answer-batches.ts'))};`, resolveDir: repository, sourcefile: 'budget-measurement-entry.ts' },
    outfile: clientBundle, bundle: true, platform: 'node', format: 'esm', packages: 'external', tsconfig: join(repository, 'tsconfig.json'), logLevel: 'silent' });
  chmodSync(clientBundle, 0o600);
  const { createHttpExamClient, answerBatches } = await import(pathToFileURL(clientBundle).href);
  const browser = await chromium.connectOverCDP(endpoint.href);
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'Asia/Ho_Chi_Minh', ignoreHTTPSErrors: false });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (![manifest.appOrigin, manifest.dataOrigin].includes(url.origin)) { blockedRequests += 1; return route.abort(); }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      const allowedStart = request.method() === 'POST' && url.pathname === startPath;
      const allowedAttempt = /^\/api\/v1\/exams\/attempts\/[a-f0-9-]{36}\/(?:answers|submit|events)$/.test(url.pathname)
        && (!attemptId || url.pathname.startsWith(`/api/v1/exams/attempts/${attemptId}/`));
      if (!allowedStart && !allowedAttempt) { blockedRequests += 1; return route.abort(); }
    }
    if (request.method() === 'PUT' && url.pathname.endsWith('/answers') && !heldFirst) {
      const body = request.postDataJSON();
      check(Object.keys(body.answers).length === 1 && body.answers[fixture.simpleQuestionIds[14]] === 'prelude', 'BUDGET_PRELUDE_BARRIER');
      heldFirst = true; await firstSaveBarrier; releasedFirst = true;
    }
    return route.continue({ headers: { ...request.headers(), 'accept-encoding': 'identity' } });
  });
  await context.addCookies([{ name: actor.cookie.name, value: actor.cookie.value, url: manifest.appOrigin, secure: true, httpOnly: true, sameSite: 'Lax' },
    { name: 'locale', value: 'en', url: manifest.appOrigin, secure: true, sameSite: 'Lax' }]);
  const page = await context.newPage(); page.on('pageerror', () => { pageErrors += 1; });
  page.on('request', request => {
    if (request.method() !== 'PUT' || !new URL(request.url()).pathname.endsWith('/answers')) return;
    try { browserRequests.push({ phase, ...requestMetadata(request.postData(), request.headers()['x-academy-exam-ack'] === 'compact-v1') }); }
    catch { observerErrors += 1; }
  });
  page.on('response', response => {
    const request = response.request(), url = new URL(request.url());
    if (!url.pathname.startsWith('/api/v1/exams/')) return;
    observerTasks.push((async () => {
      try {
        const bytes = await response.body();
        check(!response.headers()['content-encoding'] || response.headers()['content-encoding'] === 'identity', 'BUDGET_BROWSER_ENCODING');
        const measured = { phase, method: request.method(), status: response.status(), responseBytes: bytes.length, responseSha256: digest(bytes) };
        if (request.method() === 'PUT') {
          const expected = request.postDataJSON().answers, envelope = JSON.parse(bytes.toString('utf8'));
          check(envelope.data?.format === 'compact-v1' && Array.isArray(envelope.data.answers), 'BUDGET_BROWSER_COMPACT_ACK');
          const acknowledgements = envelope.data.answers;
          check(acknowledgements.length === Object.keys(expected).length && new Set(acknowledgements.map(value => value.questionId)).size === acknowledgements.length
            && acknowledgements.every(value => Object.keys(value).length === 2 && Object.hasOwn(value, 'answer')
              && Object.hasOwn(expected, value.questionId) && answerHash(expected[value.questionId]) === answerHash(value.answer)), 'BUDGET_BROWSER_ACK_MISMATCH');
          measured.ackRootCount = acknowledgements.length; measured.compactAckValidated = true;
        }
        browserResponses.push(measured);
      } catch { observerErrors += 1; }
    })());
  });
  phase = 'browser-start';
  await page.goto(`${manifest.appOrigin}/app/courses/${fixture.courseId}/items/${fixture.itemId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: copy.player.start ?? 'Start exam', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByRole('button', { name: copy.player.start ?? 'Start exam', exact: true }).click();
  await page.getByRole('button', { name: copy.player.submit, exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  const attempt = (await db.query('select id from public.exam_attempts where user_id=$1 and course_version_id=$2 and item_id=$3 and status=$4', [actor.userId, fixture.versionId, fixture.itemId, 'in_progress'])).rows;
  check(attempt.length === 1, 'BUDGET_STARTED_ATTEMPT'); attemptId = attempt[0].id;
  phase = 'queued-fourteen-dirty';
  await page.getByRole('textbox', { name: 'Budget response 15', exact: true }).fill('prelude');
  await poll(() => heldFirst, 'BUDGET_FIRST_PUT_NOT_HELD');
  const fillStarted = performance.now();
  for (let index = 1; index <= 14; index++) await page.getByRole('textbox', { name: `Budget response ${index}`, exact: true }).fill('S'.repeat(5000));
  const queuedCorrect = await page.evaluate(() => Array.from({ length: 14 }, (_, index) => {
    const field = document.querySelector(`textarea[aria-label="Budget response ${index + 1}"]`);
    return field?.value === 'S'.repeat(5000);
  }).every(Boolean));
  check(queuedCorrect && (await storedAnswers())[fixture.simpleQuestionIds[0]] === undefined, 'BUDGET_FOURTEEN_NOT_QUEUED');
  releaseFirst();
  await poll(async () => { const saved = await storedAnswers(); return fixture.simpleQuestionIds.slice(0, 14).every(id => typeof saved[id] === 'string' && saved[id].length === 5000) && saved[fixture.simpleQuestionIds[14]] === 'prelude'; }, 'BUDGET_FOURTEEN_NOT_PERSISTED');
  await poll(() => browserResponses.filter(value => value.compactAckValidated).length >= 3, 'BUDGET_FOURTEEN_ACKS');
  check(releasedFirst && browserRequests.length >= 3 && browserRequests.every(value => value.compact), 'BUDGET_UI_BATCH_SPLIT');
  receipt.stages.push({ phase, queuedDirtyRootCount: 14, eachAnswerBytes: 5000, combinedDirtyBytes: 70_000,
    actualPutCount: browserRequests.length, maxKeyedBytes: Math.max(...browserRequests.map(value => value.keyedBytes)), fillElapsedMs: performance.now() - fillStarted });

  phase = 'oversized-group'; const beforeGroup = browserRequests.length;
  await page.getByRole('textbox', { name: 'Budget group child one', exact: true }).fill('A'.repeat(40_000));
  await page.getByRole('textbox', { name: 'Budget group child two', exact: true }).fill('B'.repeat(40_000));
  const warning = page.getByRole('alert').filter({ hasText: copy.player.answerTooLarge.replace('{number}', '200') });
  await warning.waitFor({ state: 'visible', timeout: 15_000 });
  check((await warning.innerText()).includes(copy.player.groupAnswerSizeLimit), 'BUDGET_ACTIONABLE_GROUP_LIMIT');
  await page.waitForTimeout(1400);
  check(browserRequests.length === beforeGroup && (await storedAnswers())[fixture.groupQuestionId] === undefined, 'BUDGET_OVERSIZED_GROUP_REACHED_NETWORK');
  check(await page.getByRole('button', { name: copy.player.submit, exact: true }).isDisabled(), 'BUDGET_OVERSIZED_SUBMIT_ENABLED');
  receipt.stages.push({ phase, questionNumber: 200, eachChildBytes: 40_000, attemptedParentBytes: 80_000, actualPutCount: 0, actionableGroupWarning: true });
  phase = 'shortened-atomic-group';
  await page.getByRole('textbox', { name: 'Budget group child one', exact: true }).fill('A'.repeat(20_000));
  const groupAnswer = { [fixture.groupChildQuestionIds[0]]: 'A'.repeat(20_000), [fixture.groupChildQuestionIds[1]]: 'B'.repeat(40_000) };
  await poll(async () => answerHash((await storedAnswers())[fixture.groupQuestionId]) === answerHash(groupAnswer), 'BUDGET_GROUP_SIBLING_NOT_PERSISTED');
  await poll(() => browserResponses.filter(value => value.compactAckValidated).length > beforeGroup, 'BUDGET_GROUP_ACK');
  receipt.stages.push({ phase, parentAnswerBytes: Buffer.byteLength(JSON.stringify(groupAnswer)), parentSha256: answerHash(groupAnswer), savedSiblingBytes: 40_000 });

  phase = 'large-aggregate-bounded-batches';
  const expected = Object.fromEntries(fixture.simpleQuestionIds.map((id, index) => [id, String.fromCharCode(65 + index % 26).repeat(25_000)]));
  expected[fixture.groupQuestionId] = groupAnswer;
  const groups = Object.fromEntries(Object.keys(expected).map(id => [id, 'main']));
  const client = createHttpExamClient({ courseId: fixture.courseId, itemId: fixture.itemId, attemptId, fetcher: actualFetch });
  const batches = answerBatches(expected, groups);
  for (const batch of batches) {
    const acknowledged = await client.save(batch.answers);
    check(acknowledged.length === Object.keys(batch.answers).length, 'BUDGET_ACTUAL_CLIENT_ACK_COUNT');
  }
  const stored = await storedAnswers();
  check(Object.keys(stored).length === 200 && answerHash(stored) === answerHash(expected), 'BUDGET_NATIVE_AGGREGATE_MISMATCH');
  const session = await client.session();
  check(answerHash(session.attempt?.answers) === answerHash(expected), 'BUDGET_SESSION_ANSWERS');
  const legacy = await actualFetch(`/api/v1/exams/attempts/${attemptId}/answers`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answers: { [fixture.simpleQuestionIds[0]]: expected[fixture.simpleQuestionIds[0]] } }) });
  check(legacy.ok, 'BUDGET_LEGACY_ACK_STATUS');
  const legacyBody = await legacy.json();
  check(Array.isArray(legacyBody.data) && legacyBody.data.length === 200
    && answerHash(Object.fromEntries(legacyBody.data.map(value => [value.questionId, value.answer]))) === answerHash(expected), 'BUDGET_LEGACY_ACK_CONTENT');
  receipt.stages.push({ phase, batchCount: batches.length, nativeRootCount: Object.keys(stored).length,
    nativeAnswerJsonBytes: Buffer.byteLength(JSON.stringify(stored)), nativeAnswerSha256: answerHash(stored) });

  phase = 'browser-formal-submit';
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: copy.player.submit, exact: true }).waitFor({ state: 'visible', timeout: 45_000 });
  const submitted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/exams/attempts/${attemptId}/submit`, { timeout: 90_000 });
  const browserReview = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/v1/exams/attempts/${attemptId}/review`, { timeout: 90_000 });
  await page.getByRole('button', { name: copy.player.submit, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: copy.player.dialogTitle, exact: true });
  await dialog.getByRole('button', { name: copy.player.confirm, exact: true }).click();
  check((await submitted).status() === 200, 'BUDGET_BROWSER_SUBMIT_STATUS');
  const browserReviewResponse = await browserReview;
  check(browserReviewResponse.status() === 200, 'BUDGET_BROWSER_REVIEW_STATUS');
  await browserReviewResponse.finished();
  await poll(async () => ['graded', 'pending_manual'].includes((await db.query('select status from public.exam_attempts where id=$1 and user_id=$2 and course_version_id=$3', [attemptId, actor.userId, fixture.versionId])).rows[0]?.status), 'BUDGET_NATIVE_SUBMIT_NOT_FINAL', 90_000);
  const review = await client.review();
  check(answerHash(review.answers) === answerHash(expected), 'BUDGET_REVIEW_ANSWERS');
  check(answerHash(await storedAnswers()) === answerHash(expected), 'BUDGET_SUBMIT_LOST_NATIVE_ANSWERS');
  await Promise.all(observerTasks);
  check(observerErrors === 0 && pageErrors === 0, 'BUDGET_BROWSER_OBSERVER_FAILURE');
  const largeKinds = new Set(nativeRequests.filter(value => value.responseBytes > threshold).map(value => value.kind));
  check(largeKinds.has('session') && largeKinds.has('answers') && largeKinds.has('review'), 'BUDGET_LARGE_RESPONSE_CASE_NOT_REACHED');
  const proxy = tail(proxyFile, proxyOffset);
  const largeWireKinds = new Set(proxy.filter(value => value.wireBytes > threshold && value.status === 200 && value.contentEncoding === 'identity').map(value => value.kind));
  check(largeWireKinds.has('session') && largeWireKinds.has('save') && largeWireKinds.has('review'), 'BUDGET_PROXY_LARGE_WIRE_MEASUREMENT');
  const rpc = tail(outboundFile, outboundOffset).filter(value => value.outcome === 'measured-exam-rpc');
  const finalize = rpc.filter(value => value.rpc === 'exam_finalize_attempt' && value.status === 200);
  check(finalize.length > 0 && finalize.every(value => Number.isInteger(value.outboundBodyBytes ?? value.requestBodyBytes)), 'BUDGET_FORMAL_RPC_METRIC_MISSING');
  check(digest(JSON.stringify(await budgetDefaults(db, manifest))) === fixture.baselineEnrollmentSha256, 'BUDGET_DEFAULT_ENROLLMENTS_CHANGED');
  receipt.passed = true; receipt.browserRequestMetrics = browserRequests; receipt.browserResponseMetrics = browserResponses;
  receipt.actualClientHttpMetrics = nativeRequests;
  receipt.proxyWireMetrics = proxy.map(value => ({ kind: value.kind, status: value.status, wireBytes: value.wireBytes, elapsedMs: value.elapsedMs, contentEncoding: value.contentEncoding }));
  receipt.outboundRpcMetrics = rpc.map(value => ({ kind: value.rpc, status: value.status,
    outboundBodyBytes: value.outboundBodyBytes ?? value.requestBodyBytes, elapsedToHeadersMs: value.elapsedToHeadersMs }));
  receipt.pageErrorCount = pageErrors; receipt.blockedRequestCount = blockedRequests; receipt.originalEnrollmentsUnchanged = true;
  exitCode = 0;
} catch {
  // Never serialize exception text, DTOs, browser storage, answer values or session handles.
  receipt.failure = { phase, code: 'BUDGET_MEASUREMENT_FAILED', pageErrorCount: pageErrors, observerErrorCount: observerErrors };
} finally {
  releaseFirst?.();
  receipt.browserRequestMetrics = browserRequests; receipt.browserResponseMetrics = browserResponses;
  receipt.actualClientHttpMetrics = nativeRequests;
  const file = join(manifest.runtime, 'budget-measurement.json');
  writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  await context?.close().catch(() => {}); await db.end().catch(() => {});
  console.log(JSON.stringify({ passed: receipt.passed, receipt: file }));
}
// Disconnect this worker only. Never Browser.close() the lead-owned trusted browser.
process.exit(exitCode);
