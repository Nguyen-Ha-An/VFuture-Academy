import http from 'node:http';
import https from 'node:https';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Ledger, initializeState, atomicWrite, acquireStateLock } from './ledger.mjs';

export { initializeState };
const MiB = 1024 * 1024;
const DEFAULT_LIMITS = Object.freeze({ backendRps: 60, backendBurst: 60, authRps: 10, authBurst: 25, inflight: 16, queue: 16, queueTimeoutMs: 3000, requestBytes: 4 * MiB, authBytes: 64 * 1024, uploadBytes: 50 * MiB, multipartOverheadBytes: 64 * 1024, storageResponseBytes: 50 * MiB, responseBytes: 4 * MiB, requestTimeoutMs: 20_000, transferTimeoutMs: 120_000, uploads: 4, downloads: 16, userDailyDownloadBytes: 100 * MiB, siteDailyDownloadBytes: 2 * 1024 * MiB, monthlyWarningBytes: 40_000_000_000, monthlyDiscretionaryBytes: 45_000_000_000, monthlyBytes: 50_000_000_000, responseChunkBytes: 64 * 1024, responseOverheadBytes: 16 * 1024 });
const AUTH_METHODS = new Map([['token', ['POST']], ['signup', ['POST']], ['recover', ['POST']], ['otp', ['POST']], ['verify', ['GET', 'POST']], ['authorize', ['GET']], ['callback', ['GET', 'POST']], ['user', ['GET', 'PUT']], ['logout', ['POST']]]);
const CRITICAL_RPC = new Set(['exam_save_active_answers', 'exam_finalize_attempt', 'exam_append_attempt_events', 'rate_limit', 'authorization_actor', 'xp_update_streak', 'learner_complete_course']);
const CRITICAL_RECEIPTS = new Set(['/rest/v1/exam_grades', '/rest/v1/skill_evidence', '/rest/v1/xp_events', '/rest/v1/lesson_progress']);
const REQUEST_HEADERS = new Set(['authorization', 'apikey', 'content-type', 'accept', 'accept-language', 'prefer', 'range-unit', 'if-match', 'if-none-match', 'if-modified-since', 'x-client-info', 'x-supabase-api-version', 'x-upsert', 'content-profile', 'accept-profile', 'cache-control', 'x-metadata']);
const RESPONSE_HEADERS = new Set(['content-type', 'content-encoding', 'content-language', 'cache-control', 'expires', 'etag', 'last-modified', 'content-disposition', 'content-range', 'range-unit', 'retry-after', 'www-authenticate', 'preference-applied', 'set-cookie']);

function validSecret(secret) { return typeof secret === 'string' && Buffer.byteLength(secret) >= 32 && secret.length <= 1024; }
function constantEqual(left, right) {
  if (typeof left !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}
function privateOrigin(value, component) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid_upstream');
  const host = url.hostname;
  const privateIp = isIP(host) === 4 && (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host));
  if (!privateIp && host !== component) throw new Error('upstream_must_be_fixed_private_origin');
  return url;
}
function isRepeatableRestFilter(key, values) {
  // PostgREST combines repeated column predicates and logical filters. Control
  // parameters remain single-valued; never apply this exception to Auth/Storage.
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key) || ['select', 'order', 'limit', 'offset', 'columns', 'on_conflict', 'token', 'gateway_grant', 'grant_type'].includes(key)) return false;
  if (/(?:^|\.)(?:or|and)$/.test(key)) return values.every(value => value.startsWith('(') && value.endsWith(')'));
  return values.every(value => /^(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|match|imatch|is|isdistinct|in|cs|cd|ov|sl|sr|nxl|nxr|adj|(?:fts|plfts|phfts|wfts)(?:\([^)]*\))?)\./.test(value));
}
function canonicalTarget(raw, trusted) {
  if (typeof raw !== 'string' || raw.length > 8192 || !raw.startsWith('/') || raw.startsWith('//') || /[\x00-\x20\x7f\\#]/.test(raw)) throw new Error('invalid_target');
  const [path, ...queryParts] = raw.split('?');
  if (queryParts.length > 1 || path.includes('//') || (path.length > 1 && path.endsWith('/'))) throw new Error('invalid_path');
  for (const segment of path.split('/').slice(1)) {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { throw new Error('invalid_path'); }
    if (decoded === '.' || decoded === '..' || /[\x00-\x1f\x7f\\/%]/.test(decoded) || encodeURIComponent(decoded) !== segment) throw new Error('invalid_path');
  }
  const query = queryParts[0] ?? '';
  if (/%(?![a-fA-F0-9]{2})/.test(query) || /%(?:00|0a|0d|5c)/i.test(query)) throw new Error('invalid_query');
  const params = new URLSearchParams(query), keys = new Set();
  for (const [key, value] of params) {
    if (/[\x00-\x1f\x7f]/.test(key + value) || (keys.has(key) && !(trusted && path.startsWith('/rest/v1/') && isRepeatableRestFilter(key, params.getAll(key))))) throw new Error('duplicate_or_invalid_query');
    keys.add(key);
  }
  return { path, params };
}
function publicAuth(path, method) { return AUTH_METHODS.get(path.slice('/auth/v1/'.length))?.includes(method) && path.startsWith('/auth/v1/'); }
function criticalRequest(path, method, params, trusted) {
  if (path === '/auth/v1/token' && method === 'POST' && params.get('grant_type') === 'refresh_token') return true;
  if (path === '/auth/v1/user' && method === 'GET') return true;
  if (path === '/auth/v1/logout' && method === 'POST') return true;
  if (!trusted) return false;
  if (path.startsWith('/rest/v1/') && ['GET', 'HEAD'].includes(method)) return true;
  if (method === 'POST' && CRITICAL_RECEIPTS.has(path)) return true;
  return method === 'POST' && CRITICAL_RPC.has(path.slice('/rest/v1/rpc/'.length)) && path.startsWith('/rest/v1/rpc/');
}
function maintenance(path, now) {
  try {
    if (statSync(path).size > 2048) return 'drain';
    const value = JSON.parse(readFileSync(path, 'utf8'));
    const updated = Date.parse(value.updatedAt), expires = Date.parse(value.expiresAt);
    if (value.version !== 1 || !['normal', 'discretionary-stop', 'drain'].includes(value.mode) || !Number.isFinite(updated) || !Number.isFinite(expires) || updated > now + 30_000 || expires <= now || expires <= updated || expires - updated > 900_000) return 'drain';
    if (value.drainAfter !== undefined) {
      const requested = Date.parse(value.financialRequestedAt), deadline = Date.parse(value.drainAfter);
      if (value.drainReason !== 'financial' || !['discretionary-stop', 'drain'].includes(value.mode) || !Number.isFinite(requested) || !Number.isFinite(deadline) || requested > now + 30_000 || deadline <= requested || deadline - requested > 120_000) return 'drain';
      if (now >= deadline) return 'drain';
    } else if (value.mode === 'discretionary-stop' && (value.drainReason === 'financial' || value.financialRequestedAt !== undefined)) return 'drain';
    return value.mode;
  } catch { return 'drain'; }
}
function verifyGrant(token, key, path, method, now, limits) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const pieces = token.split('.');
  if (pieces.length !== 2 || !pieces.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const signature = createHmac('sha256', key).update(pieces[0]).digest('base64url');
  if (!constantEqual(pieces[1], signature)) return null;
  try {
    const grant = JSON.parse(Buffer.from(pieces[0], 'base64url').toString('utf8'));
    const upload = path.startsWith('/storage/v1/object/upload/sign/');
    if (grant.v !== 1 || grant.aud !== 'vfuture-storage-transfer' || (!/^[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$/.test(grant.sub) && !(grant.sub === 'public' && !upload)) || !/^[A-Za-z0-9_-]{16,128}$/.test(grant.jti) || grant.path !== path || (grant.method !== method && !(method === 'HEAD' && grant.method === 'GET')) || !Number.isSafeInteger(grant.maxBytes) || grant.maxBytes <= 0 || grant.maxBytes > (upload ? limits.uploadBytes : limits.userDailyDownloadBytes) || !Number.isSafeInteger(grant.exp) || grant.exp * 1000 <= now || grant.exp * 1000 > now + 900_000) return null;
    return { ...grant, sub: grant.sub.toLowerCase() };
  } catch { return null; }
}
class Bucket {
  constructor(rate, capacity) { this.rate = rate; this.capacity = capacity; this.tokens = capacity; this.updated = performance.now(); }
  take() { const now = performance.now(); this.tokens = Math.min(this.capacity, this.tokens + (now - this.updated) / 1000 * this.rate); this.updated = now; if (this.tokens < 1) return false; this.tokens -= 1; return true; }
}
class Admission {
  constructor(limits) { this.limits = limits; this.active = 0; this.queue = []; }
  acquire(req, res) {
    if (this.active < this.limits.inflight) { this.active++; return Promise.resolve(true); }
    if (this.queue.length >= this.limits.queue) return Promise.resolve(false);
    return new Promise(resolve => {
      const entry = { finish: result => { clearTimeout(timer); res.removeListener('close', canceled); const index = this.queue.indexOf(entry); if (index !== -1) this.queue.splice(index, 1); if (result) this.active++; resolve(result); } };
      const canceled = () => entry.finish(false);
      const timer = setTimeout(canceled, this.limits.queueTimeoutMs); timer.unref();
      res.once('close', canceled); this.queue.push(entry);
      if (req.aborted || res.destroyed) canceled();
    });
  }
  release() { this.active--; this.queue[0]?.finish(true); }
}
function sizeGuard(limit, beforeChunk) {
  let bytes = 0;
  return new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > limit) return callback(Object.assign(new Error('body_limit'), { statusCode: 413 }));
    try { beforeChunk?.(chunk.length); callback(null, chunk); } catch { callback(new Error('egress_limit')); }
  } });
}
async function authBody(req, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('body_limit'), { statusCode: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

/** Fixed origins and limits are process configuration only, never request input. */
export function createGateway(options) {
  const { gatewayKey, transferGrantKey, stateDir, maintenanceFile } = options;
  if (!validSecret(gatewayKey) || !validSecret(transferGrantKey) || !stateDir || !maintenanceFile) throw new Error('missing_gateway_configuration');
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const [key, value] of Object.entries(limits)) if (!Number.isFinite(value) || value <= 0 || value > DEFAULT_LIMITS[key]) throw new Error('invalid_or_unbounded_limit');
  if (limits.monthlyWarningBytes > limits.monthlyDiscretionaryBytes || limits.monthlyDiscretionaryBytes > limits.monthlyBytes) throw new Error('invalid_budget_limits');
  const origins = { auth: privateOrigin(options.authUrl, 'auth'), rest: privateOrigin(options.restUrl, 'rest'), storage: privateOrigin(options.storageUrl, 'storage') };
  if (options.trustedProxyIp && !isIP(options.trustedProxyIp)) throw new Error('invalid_trusted_proxy');
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  for (const origin of allowedOrigins) { const u = new URL(origin); if (u.origin !== origin || u.protocol !== 'https:') throw new Error('invalid_cors_origin'); }
  const ledger = new Ledger(stateDir, limits), backend = new Bucket(limits.backendRps, limits.backendBurst), auth = new Bucket(limits.authRps, limits.authBurst), admissions = new Admission(limits);
  const releaseStateLock = acquireStateLock(stateDir);
  const users = new Map(), accounts = new Map();
  const criticalResponses = new WeakSet(), rejections = new Bucket(limits.backendRps, limits.backendBurst), authPreflights = new Bucket(limits.authRps, limits.authBurst); let uploads = 0, downloads = 0;
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: limits.inflight, maxFreeSockets: 4 });
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: limits.inflight, maxFreeSockets: 4 });
  function deny(res, status) {
    if (res.destroyed) return;
    if (!rejections.take()) { res.destroy(); return; }
    try {
      if (!ledger.reserveOutbound(limits.responseOverheadBytes, criticalResponses.has(res), Date.now())) { res.destroy(); return; }
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '5', 'connection': 'close' });
      res.end(JSON.stringify({ error: status === 429 ? 'rate_limited' : status === 503 ? 'temporarily_unavailable' : 'request_rejected' }));
    } catch { res.destroy(); }
  }
  const server = http.createServer({ maxHeaderSize: 16 * 1024, requireHostHeader: true }, (req, res) => {
    req.pause();
    if (!backend.take()) { deny(res, 429); return; }
    const deadline = setTimeout(() => deny(res, 504), req.url?.startsWith('/storage/v1/object/') ? limits.transferTimeoutMs : limits.requestTimeoutMs); deadline.unref();
    res.once('close', () => { clearTimeout(deadline); if (!req.complete) req.destroy(); });
    void handle(req, res).catch(() => deny(res, 503));
  });
  async function handle(req, res) {
    const trusted = constantEqual(req.headers['x-vfuture-gateway-key'], gatewayKey);
    let target;
    try { target = canonicalTarget(req.url, trusted); } catch { deny(res, 400); return; }
    const { path, params } = target, method = req.method ?? '';
    const now = Date.now();
    const signedUpload = /^\/storage\/v1\/object\/upload\/sign\/[A-Za-z0-9_-]+\/.+$/.test(path) && ['PUT', 'POST'].includes(method) && params.has('token');
    const signedDownload = /^\/storage\/v1\/object\/sign\/[A-Za-z0-9_-]+\/.+$/.test(path) && ['GET', 'HEAD'].includes(method);
    const transfer = signedUpload || signedDownload;
    const isAuth = publicAuth(path, method);
    const serverRest = trusted && path.startsWith('/rest/v1/') && /^(GET|HEAD|POST|PATCH|DELETE)$/.test(method);
    const serverAuth = trusted && /^\/auth\/v1\/admin\//.test(path);
    const objectPath = /^\/storage\/v1\/object\/(?:authenticated\/)?([A-Za-z0-9_-]+)\/(.+)$/.exec(path);
    const directObject = objectPath && !['authenticated', 'public', 'sign', 'upload', 'list', 'copy', 'move', 'info'].includes(objectPath[1]);
    const serverUpload = trusted && directObject && ['POST', 'PUT'].includes(method);
    const serverDownload = trusted && directObject && ['GET', 'HEAD'].includes(method);
    const objectTransfer = transfer || serverUpload || serverDownload;
    const uploadTransfer = signedUpload || serverUpload;
    const serverStorage = trusted && path.startsWith('/storage/v1/') && (serverUpload || serverDownload || method === 'DELETE' || (method === 'POST' && /^\/storage\/v1\/object\/(?:upload\/sign|sign|list)\//.test(path)) || (method === 'GET' && /^\/storage\/v1\/bucket(?:\/|$)/.test(path)));
    if (method === 'OPTIONS') {
      const requested = req.headers['access-control-request-method'];
      const requestedHeaders = String(req.headers['access-control-request-headers'] ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
      const publicTransfer = /^\/storage\/v1\/object\/(?:upload\/sign|sign)\/[A-Za-z0-9_-]+\/.+$/.test(path) && ['PUT', 'POST', 'GET', 'HEAD'].includes(requested);
      if (!allowedOrigins.has(req.headers.origin) || (!publicAuth(path, requested) && !publicTransfer) || requestedHeaders.some(h => !REQUEST_HEADERS.has(h))) { deny(res, 403); return; }
      const authPreflight = publicAuth(path, requested);
      const preflightCritical = authPreflight && criticalRequest(path, requested, params, false);
      const preflightMode = maintenance(maintenanceFile, now);
      if (preflightMode === 'drain' || (preflightMode === 'discretionary-stop' && !preflightCritical)) { deny(res, 503); return; }
      if ((authPreflight && !authPreflights.take()) || !ledger.reserveOutbound(limits.responseOverheadBytes, preflightCritical, now)) { deny(res, 429); return; }
      res.writeHead(204, { 'access-control-allow-origin': req.headers.origin, 'access-control-allow-methods': requested, 'access-control-allow-headers': requestedHeaders.join(','), 'access-control-max-age': '300', vary: 'Origin' }); res.end(); return;
    }
    if (!isAuth && !serverRest && !serverAuth && !serverStorage && !transfer) { deny(res, 403); return; }
    if ((serverRest || serverAuth || serverStorage) && !/^Bearer [^\s]+$/.test(req.headers.authorization ?? '')) { deny(res, 403); return; }
    if (req.headers.range || req.headers['content-encoding'] || (req.headers['content-length'] && !/^\d+$/.test(req.headers['content-length']))) { deny(res, 400); return; }
    if (req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'x-vfuture-gateway-key').length > 1) { deny(res, 400); return; }
    const critical = criticalRequest(path, method, params, trusted), mode = maintenance(maintenanceFile, now);
    if (critical && trusted) criticalResponses.add(res);
    if (mode === 'drain' || (mode === 'discretionary-stop' && !critical)) { deny(res, 503); return; }
    if (isAuth && !auth.take()) { deny(res, 429); return; }
    let grant;
    if (transfer) {
      grant = verifyGrant(params.get('gateway_grant'), transferGrantKey, path, method, now, limits);
      if (!grant || !params.get('token')) { deny(res, 403); return; }
      params.delete('gateway_grant');
      const count = users.get(grant.sub) ?? { uploads: 0, downloads: 0 };
      if ((signedUpload && (uploads >= limits.uploads || count.uploads >= 1)) || (signedDownload && (downloads >= limits.downloads || (grant.sub !== 'public' && count.downloads >= 4)))) { deny(res, 429); return; }
    } else if (params.has('gateway_grant')) { deny(res, 400); return; }
    if (objectTransfer && (uploadTransfer ? uploads >= limits.uploads : downloads >= limits.downloads)) { deny(res, 429); return; }
    const multipart = /^multipart\/form-data(?:;|$)/i.test(String(req.headers['content-type'] ?? ''));
    const requestLimit = signedUpload ? grant.maxBytes : serverUpload ? limits.uploadBytes + (multipart ? limits.multipartOverheadBytes : 0) : isAuth ? limits.authBytes : limits.requestBytes;
    if (Number(req.headers['content-length'] ?? 0) > requestLimit) { deny(res, 413); return; }
    if (!await admissions.acquire(req, res)) { deny(res, 503); return; }
    if (res.destroyed) { admissions.release(); return; }
    // Queued work must observe maintenance transitions before reaching a backend.
    const currentMode = maintenance(maintenanceFile, Date.now());
    if (currentMode === 'drain' || (currentMode === 'discretionary-stop' && !critical)) { admissions.release(); deny(res, 503); return; }
    let releaseTransfer = () => {};
    try {
      if (objectTransfer) {
        const count = grant ? (users.get(grant.sub) ?? { uploads: 0, downloads: 0 }) : null;
        if ((uploadTransfer && (uploads >= limits.uploads || (count && count.uploads >= 1))) || (!uploadTransfer && (downloads >= limits.downloads || (count && grant.sub !== 'public' && count.downloads >= 4)))) { deny(res, 429); return; }
        if (grant) {
          const status = ledger.admitTransfer(grant, signedUpload, method === 'HEAD', Date.now());
          if (status) { deny(res, status); return; }
        }
        if (uploadTransfer) { uploads++; if (count) count.uploads++; } else { downloads++; if (count) count.downloads++; }
        if (count) users.set(grant.sub, count);
        releaseTransfer = () => {
          if (uploadTransfer) { uploads--; if (count) count.uploads--; } else { downloads--; if (count) count.downloads--; }
          if (count && !count.uploads && !count.downloads) users.delete(grant.sub);
        };
      }
      let reserved = limits.responseChunkBytes;
      if (!ledger.reserveOutbound(reserved + limits.responseOverheadBytes, critical, Date.now())) { deny(res, 503); return; }
      let bufferedBody;
      if (isAuth && ['POST', 'PUT'].includes(method)) {
        bufferedBody = await authBody(req, limits.authBytes);
        if (bufferedBody.length) {
          let body;
          try { body = JSON.parse(bufferedBody.toString('utf8')); } catch { deny(res, 400); return; }
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'email' && key.toLowerCase() === 'email')) { deny(res, 400); return; }
          const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
          if (email) {
            const id = createHmac('sha256', transferGrantKey).update(email).digest('hex');
            for (const [account, entry] of accounts) if (entry.expires < Date.now()) accounts.delete(account);
            if (!accounts.has(id)) { if (accounts.size >= 10_000) { deny(res, 429); return; } accounts.set(id, { bucket: new Bucket(5 / 60, 5), expires: Date.now() + 60_000 }); }
            if (!accounts.get(id).bucket.take()) { deny(res, 429); return; }
            if ((['/auth/v1/signup', '/auth/v1/recover', '/auth/v1/otp'].includes(path) || (path === '/auth/v1/user' && method === 'PUT')) && !ledger.reserveEmail(id, Date.now(), path === '/auth/v1/user' ? 2 : 1)) { deny(res, 429); return; }
          } else if (['/auth/v1/signup', '/auth/v1/recover', '/auth/v1/otp'].includes(path)) { deny(res, 400); return; }
        }
      }
      const component = path.split('/')[1], origin = origins[component];
      const upstreamPath = path.slice(`/${component}/v1`.length) + (params.size ? `?${params}` : '');
      const headers = {};
      for (const [key, value] of Object.entries(req.headers)) if (REQUEST_HEADERS.has(key)) headers[key] = value;
      // Never forward Connection-nominated hop-by-hop headers, even allowlisted ones.
      for (const key of String(req.headers.connection ?? '').split(',')) delete headers[key.trim().toLowerCase()];
      if (options.trustedProxyIp && req.socket.remoteAddress?.replace(/^::ffff:/, '') === options.trustedProxyIp && typeof req.headers['x-forwarded-for'] === 'string' && isIP(req.headers['x-forwarded-for'])) headers['x-forwarded-for'] = req.headers['x-forwarded-for'];
      if (bufferedBody) headers['content-length'] = String(bufferedBody.length);
      else if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
      if (allowedOrigins.has(req.headers.origin)) { res.setHeader('access-control-allow-origin', req.headers.origin); res.setHeader('vary', 'Origin'); res.setHeader('access-control-expose-headers', 'Content-Range,Retry-After'); }
      await new Promise(resolveProxy => {
        let finished = false, upstreamResponse;
        const upstream = (origin.protocol === 'http:' ? http : https).request(origin, { method, path: upstreamPath, headers, agent: origin.protocol === 'http:' ? httpAgent : httpsAgent }, response => {
          upstreamResponse = response;
          // Server credentials must never be replayed by an SDK following Location.
          if ([300, 301, 302, 303, 305, 307, 308].includes(response.statusCode) && trusted) { response.destroy(); deny(res, 502); finish(); return; }
          const responseLimit = method === 'HEAD' ? 0 : signedDownload ? grant.maxBytes : serverDownload ? limits.storageResponseBytes : limits.responseBytes;
          if (Number(response.headers['content-length'] ?? 0) > responseLimit && method !== 'HEAD') { response.destroy(); deny(res, 502); finish(); return; }
          for (const [key, value] of Object.entries(response.headers)) if (RESPONSE_HEADERS.has(key) && value !== undefined) res.setHeader(key, value);
          // Only public Auth flows may return a browser redirect. No secret was forwarded.
          if (isAuth && !trusted && response.headers.location) res.setHeader('location', response.headers.location);
          res.statusCode = response.statusCode ?? 502;
          if (method === 'HEAD') { response.resume(); res.end(); finish(); return; }
          let outputBytes = 0;
          const budget = sizeGuard(responseLimit, bytes => {
            if (serverDownload && !ledger.reserveServerDownload(bytes, Date.now())) throw new Error('download_budget_exhausted');
            // Conservative framing/TLS allowance; Azure wire-meter telemetry is separate.
            outputBytes += bytes + Math.max(128, Math.ceil(bytes * 0.05));
            if (outputBytes > reserved) {
              const more = Math.ceil((outputBytes - reserved) / limits.responseChunkBytes) * limits.responseChunkBytes;
              if (!ledger.reserveOutbound(more, critical, Date.now())) throw new Error('budget_exhausted');
              reserved += more;
            }
          });
          pipeline(response, budget, res).then(finish, () => { res.destroy(); upstream.destroy(); finish(); });
        });
        const finish = () => { if (finished) return; finished = true; clearTimeout(timer); res.removeListener('close', canceled); req.removeListener('aborted', canceled); resolveProxy(); };
        const canceled = () => { upstream.destroy(); upstreamResponse?.destroy(); finish(); };
        const timer = setTimeout(() => { upstream.destroy(); upstreamResponse?.destroy(); deny(res, 504); finish(); }, objectTransfer ? limits.transferTimeoutMs : limits.requestTimeoutMs); timer.unref();
        res.once('close', canceled); req.once('aborted', canceled);
        upstream.on('error', () => { deny(res, 502); finish(); });
        if (bufferedBody) upstream.end(bufferedBody);
        else {
          const input = sizeGuard(requestLimit);
          input.on('error', error => { deny(res, error.statusCode ?? 413); upstream.destroy(); finish(); });
          req.on('error', canceled); req.pipe(input).pipe(upstream); req.resume();
        }
      });
    } catch (error) { deny(res, error.statusCode ?? 503); }
    finally { releaseTransfer(); admissions.release(); }
  }
  server.headersTimeout = 10_000; server.requestTimeout = limits.transferTimeoutMs; server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100;
  function publishTelemetry() {
    try {
      const p = ledger.current(Date.now());
      // Each fresh observation has its own durable sequence, including idle heartbeats.
      ledger.commit();
      atomicWrite(join(stateDir, 'telemetry.json'), { version: 1, period: p.month, observedAt: new Date().toISOString(), sequence: p.sequence, monthlyOutboundBytes: p.outbound, activeRequests: admissions.active, queuedRequests: admissions.queue.length, warning: p.outbound >= limits.monthlyWarningBytes, discretionaryStop: p.outbound >= limits.monthlyDiscretionaryBytes });
    } catch { ledger.failed = true; }
  }
  const telemetryTimer = setInterval(publishTelemetry, 10_000); telemetryTimer.unref();
  server.on('listening', publishTelemetry);
  server.on('close', () => { clearInterval(telemetryTimer); httpAgent.destroy(); httpsAgent.destroy(); publishTelemetry(); releaseStateLock(); });
  server.on('clientError', (_error, socket) => socket.destroy());
  return server;
}

export function configFromEnvironment(env = process.env) {
  return { gatewayKey: env.SUPABASE_GATEWAY_KEY, transferGrantKey: env.GATEWAY_TRANSFER_GRANT_KEY, authUrl: env.GATEWAY_AUTH_URL, restUrl: env.GATEWAY_REST_URL, storageUrl: env.GATEWAY_STORAGE_URL, stateDir: env.GATEWAY_STATE_DIR, maintenanceFile: env.GATEWAY_MAINTENANCE_FILE, trustedProxyIp: env.GATEWAY_TRUSTED_PROXY_IP, allowedOrigins: (env.GATEWAY_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--initialize-state')) initializeState({ stateDir: process.env.GATEWAY_STATE_DIR });
    else {
      const server = createGateway(configFromEnvironment());
      server.listen(8080, '0.0.0.0');
      const shutdown = () => { server.close(); setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 125_000).unref(); };
      process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    }
  } catch { process.stderr.write('gateway_startup_failed\n'); process.exitCode = 1; }
}
