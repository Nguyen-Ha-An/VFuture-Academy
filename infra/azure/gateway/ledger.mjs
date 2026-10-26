import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 10_000;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const checksum = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function atomicWrite(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path);
    const directory = openSync(join(path, '..'), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

/** A stale lock requires operator recovery; never silently resume a second writer. */
export function acquireStateLock(stateDir) {
  const path = join(stateDir, 'ledger.lock');
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); fsyncSync(fd); }
  finally { closeSync(fd); }
  let released = false;
  return () => { if (!released) { released = true; unlinkSync(path); } };
}

/** Explicit operator bootstrap only. Never overwrites an existing ledger. */
export function initializeState({ stateDir, now = Date.now() }) {
  if (!stateDir) throw new Error('state_directory_required');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const path = join(stateDir, 'ledger.json');
  if (existsSync(path)) throw new Error('state_already_initialized');
  const date = new Date(now).toISOString();
  const payload = { version: 1, sequence: 0, month: date.slice(0, 7), day: date.slice(0, 10), outbound: 0, downloadBytes: 0, users: {}, grants: {}, uploadReservations: {}, email: { hour: date.slice(0, 13), day: date.slice(0, 10), month: date.slice(0, 7), hourly: 0, daily: 0, monthly: 0, recipients: {} } };
  atomicWrite(path, { payload, checksum: checksum(payload) });
}

export class Ledger {
  constructor(stateDir, limits) {
    this.path = join(stateDir, 'ledger.json'); this.limits = limits; this.failed = false;
    if (statSync(this.path).size > MAX_LEDGER_BYTES) throw new Error('invalid_ledger');
    const record = JSON.parse(readFileSync(this.path, 'utf8'));
    const p = record.payload;
    if (!p || record.checksum !== checksum(p) || p.version !== 1 || !integer(p.sequence) || !/^\d{4}-\d{2}$/.test(p.month) || !/^\d{4}-\d{2}-\d{2}$/.test(p.day) || !integer(p.outbound) || !integer(p.downloadBytes) || !p.email || !integer(p.email.hourly) || !integer(p.email.daily) || !integer(p.email.monthly)) throw new Error('invalid_ledger');
    for (const key of ['users', 'grants', 'uploadReservations']) {
      if (!p[key] || typeof p[key] !== 'object' || Array.isArray(p[key]) || Object.keys(p[key]).length > MAX_ENTRIES) throw new Error('invalid_ledger');
    }
    if (Object.values(p.users).some(value => !integer(value))) throw new Error('invalid_ledger');
    if (Object.values(p.grants).some(value => !value || !integer(value.exp) || !integer(value.uses) || typeof value.binding !== 'string')) throw new Error('invalid_ledger');
    if (Object.values(p.uploadReservations).some(value => !Array.isArray(value) || value.length > 10 || value.some(t => !integer(t)))) throw new Error('invalid_ledger');
    if (!p.email.recipients || typeof p.email.recipients !== 'object' || Object.keys(p.email.recipients).length > MAX_ENTRIES || Object.values(p.email.recipients).some(t => !integer(t))) throw new Error('invalid_ledger');
    this.payload = p;
  }
  commit() {
    if (this.failed) throw new Error('ledger_unavailable');
    try {
      this.payload.sequence += 1;
      atomicWrite(this.path, { payload: this.payload, checksum: checksum(this.payload) });
    } catch {
      this.failed = true; throw new Error('ledger_unavailable');
    }
  }
  current(now) {
    if (this.failed) throw new Error('ledger_unavailable');
    const date = new Date(now).toISOString(), p = this.payload;
    if (date.slice(0, 7) < p.month || date.slice(0, 10) < p.day) throw new Error('clock_rollback');
    if (p.month !== date.slice(0, 7)) { p.month = date.slice(0, 7); p.outbound = 0; }
    if (p.day !== date.slice(0, 10)) { p.day = date.slice(0, 10); p.downloadBytes = 0; p.users = {}; }
    for (const [id, grant] of Object.entries(p.grants)) if (grant.exp * 1000 + 60_000 < now) delete p.grants[id];
    for (const [user, timestamps] of Object.entries(p.uploadReservations)) {
      p.uploadReservations[user] = timestamps.filter(t => t > now - 60_000);
      if (!p.uploadReservations[user].length) delete p.uploadReservations[user];
    }
    return p;
  }
  reserveOutbound(bytes, critical, now) {
    const p = this.current(now);
    const ceiling = critical ? this.limits.monthlyBytes : this.limits.monthlyDiscretionaryBytes;
    if (p.outbound + bytes > ceiling) return false;
    p.outbound += bytes; this.commit(); return true;
  }
  reserveServerDownload(bytes, now) {
    const p = this.current(now);
    if (p.downloadBytes + bytes > this.limits.siteDailyDownloadBytes) return false;
    p.downloadBytes += bytes; this.commit(); return true;
  }
  admitTransfer(grant, upload, head, now) {
    const p = this.current(now);
    const binding = checksum({ sub: grant.sub, path: grant.path, maxBytes: grant.maxBytes, exp: grant.exp, method: grant.method });
    const previous = p.grants[grant.jti];
    if (previous && (previous.binding !== binding || previous.uses >= (upload ? 1 : 4))) return 409;
    if (head) return 0;
    if (!previous && Object.keys(p.grants).length >= MAX_ENTRIES) return 503;
    if (upload) {
      const reservations = p.uploadReservations[grant.sub] ?? [];
      if (reservations.length >= 10) return 429;
      if (!p.uploadReservations[grant.sub] && Object.keys(p.uploadReservations).length >= MAX_ENTRIES) return 503;
      p.uploadReservations[grant.sub] = [...reservations, now];
    } else {
      if (!Object.hasOwn(p.users, grant.sub) && Object.keys(p.users).length >= MAX_ENTRIES) return 503;
      const userBytes = p.users[grant.sub] ?? 0;
      if ((grant.sub !== 'public' && userBytes + grant.maxBytes > this.limits.userDailyDownloadBytes) || p.downloadBytes + grant.maxBytes > this.limits.siteDailyDownloadBytes) return 429;
      if (grant.sub !== 'public') p.users[grant.sub] = userBytes + grant.maxBytes;
      p.downloadBytes += grant.maxBytes;
    }
    p.grants[grant.jti] = { exp: grant.exp, binding, uses: (previous?.uses ?? 0) + 1 };
    this.commit(); return 0;
  }
  reserveEmail(recipientHash, now, deliveries = 1) {
    const e = this.current(now).email, date = new Date(now).toISOString();
    if (e.month !== date.slice(0, 7)) { e.month = date.slice(0, 7); e.monthly = 0; }
    if (e.day !== date.slice(0, 10)) { e.day = date.slice(0, 10); e.daily = 0; }
    if (e.hour !== date.slice(0, 13)) { e.hour = date.slice(0, 13); e.hourly = 0; }
    for (const [recipient, timestamp] of Object.entries(e.recipients)) if (timestamp <= now - 60_000) delete e.recipients[recipient];
    if (e.hourly + deliveries > 100 || e.daily + deliveries > 200 || e.monthly + deliveries > 2000 || (e.recipients[recipientHash] ?? 0) > now - 60_000 || Object.keys(e.recipients).length >= MAX_ENTRIES) return false;
    e.hourly += deliveries; e.daily += deliveries; e.monthly += deliveries; e.recipients[recipientHash] = now; this.commit(); return true;
  }
}
