import test from 'node:test';
import assert from 'node:assert/strict';
import { assertClaims, parseEvent, sweep, SCHEDULE, MICROSOFT_AUTH_EVENTS_APP } from '../functions/src/core.mjs';
const tenantId = '11111111-1111-1111-1111-111111111111';
const config = { tenantId, issuer: `https://academy.ciamlogin.com/${tenantId}/v2.0`, audience: 'api-id', extensionId: 'extension', clientId: 'academy-app' };
const claims = { iss: config.issuer, aud: config.audience, tid: tenantId, azp: MICROSOFT_AUTH_EVENTS_APP, ver: '2.0' };
const body = () => ({ type: 'microsoft.graph.authenticationEvent.emailOtpSend', data: { '@odata.type': 'microsoft.graph.onOtpSendCalloutData', tenantId, customAuthenticationExtensionId: config.extensionId, otpContext: { identifier: 'student@example.com', oneTimeCode: '12345678' }, authenticationContext: { correlationId: '11111111-2222-3333-4444-555555555555', clientServicePrincipal: { appId: config.clientId } } } });
test('strict event claims reject cross tenant, issuer, audience, app and v1 tokens', () => {
  assert.doesNotThrow(() => assertClaims(claims, config));
  for (const key of ['iss', 'aud', 'tid', 'azp', 'ver']) assert.throws(() => assertClaims({ ...claims, [key]: 'other' }, config));
  assert.throws(() => assertClaims({ ...claims, aud: [config.audience] }, config));
});
test('event parsing binds tenant/extension/client and rejects malformed OTP and recipient', () => {
  assert.equal(parseEvent(body(), config).code, '12345678');
  for (const key of ['tenantId', 'customAuthenticationExtensionId']) { const b = body(); b.data[key] = 'other'; assert.throws(() => parseEvent(b, config)); }
  const b = body(); b.data.authenticationContext.clientServicePrincipal.appId = 'other'; assert.throws(() => parseEvent(b, config));
  for (const value of ['<script>', '123\n456', '']) { const b = body(); b.data.otpContext.oneTimeCode = value; assert.throws(() => parseEvent(b, config)); }
});
test('timer exact five minutes, disabled by default and single HTTPS POST with secret', async () => {
  assert.equal(SCHEDULE, '0 */5 * * * *'); let calls = 0;
  const args = { enabled: false, url: 'https://academy.example/api/v1/internal/exams/sweep', secret: 'x'.repeat(32), fetcher: async (_url, options) => { calls++; assert.equal(options.method, 'POST'); assert.equal(options.headers.authorization, `Bearer ${'x'.repeat(32)}`); return { ok: true }; } };
  await sweep(args); assert.equal(calls, 0); await sweep({ ...args, enabled: true }); assert.equal(calls, 1);
  await assert.rejects(sweep({ ...args, enabled: true, url: 'http://academy.example/api/v1/internal/exams/sweep' }));
  await assert.rejects(sweep({ ...args, enabled: true, fetcher: async () => { calls++; return { ok: false }; } })); assert.equal(calls, 2);
});
