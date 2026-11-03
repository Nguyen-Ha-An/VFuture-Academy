import { createHmac } from 'node:crypto';

export const SCHEDULE = '0 */5 * * * *';
export const MICROSOFT_AUTH_EVENTS_APP = '99045fe1-7639-4a75-9d4a-577b6ca3810f';
export const CONTINUE = { data: { '@odata.type': 'microsoft.graph.OnOtpSendResponseData', actions: [{ '@odata.type': 'microsoft.graph.OtpSend.continueWithDefaultBehavior' }] } };

export function assertClaims(claims, config) {
  if (claims.iss !== config.issuer || claims.aud !== config.audience || claims.tid !== config.tenantId ||
    claims.ver !== '2.0' || claims.azp !== MICROSOFT_AUTH_EVENTS_APP) throw new Error('unauthorized');
}
export function parseEvent(body, config) {
  const data = body?.data;
  const context = data?.authenticationContext;
  const email = data?.otpContext?.identifier;
  const code = data?.otpContext?.oneTimeCode;
  if (body?.type !== 'microsoft.graph.authenticationEvent.emailOtpSend' ||
    data?.['@odata.type'] !== 'microsoft.graph.onOtpSendCalloutData' || data?.tenantId !== config.tenantId ||
    data?.customAuthenticationExtensionId !== config.extensionId ||
    context?.clientServicePrincipal?.appId !== config.clientId ||
    typeof context?.correlationId !== 'string' || !/^[a-f\d-]{36}$/i.test(context.correlationId) ||
    typeof email !== 'string' || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
    typeof code !== 'string' || !/^\d{4,12}$/.test(code)) throw new Error('invalid_event');
  return { email, code, correlationId: context.correlationId };
}
const digest = (key, value) => createHmac('sha256', key).update(value).digest('hex');
export function eventKeys(event, secret) {
  const hash = digest(secret, `${event.correlationId}\0${event.email}\0${event.code}`);
  return { recipient: digest(secret, event.email.toLowerCase()), event: hash,
    requestId: `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}` };
}
export async function sweep({ enabled, url, secret, fetcher = fetch }) {
  if (!enabled) return { skipped: true };
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/api/v1/internal/exams/sweep' || endpoint.search || endpoint.hash || secret.length < 32) throw new Error('invalid_sweep_config');
  // No retry: a timed-out sweep may have committed. The next scheduled sweep recovers.
  const response = await fetcher(endpoint, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(90000), redirect: 'error' });
  if (!response.ok) throw new Error('sweep_failed');
  return { skipped: false };
}
