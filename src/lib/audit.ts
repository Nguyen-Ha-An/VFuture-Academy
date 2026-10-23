import 'server-only';

import type { Actor } from '@/lib/permissions';

export type AuditTarget = { type: string; id: string };

export type AuditEntry = {
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  before: unknown;
  after: unknown;
};

export interface AuditClient {
  from(table: 'audit_log'): {
    insert(entry: AuditEntry): PromiseLike<{ error: unknown | null }>;
  };
}

const SENSITIVE_KEY = /(pass|secret|token|key|credential|cookie|authorization|session|refresh|answer|response|email|phone|name|free.?text|feedback|comment|notes?|preview)/i;
// Quantifiers are bounded to real-world lengths (RFC 5321 local part and domain, ITU E.164
// digits) because scrubbing runs before the snapshot size cap: an unbounded pair of adjacent
// quantifiers would backtrack quadratically over an attacker-supplied free-text field.
const EMAIL_VALUE = /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,24}\b/gi;
const PHONE_VALUE = /(?<![\p{L}\p{N}])\+?\d[\d\s().-]{5,32}\d(?![\p{L}\p{N}])/gu;
const TOKEN_VALUE = /\b[A-Za-z0-9_-]{32,}\b/g;
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const TRUNCATION_MARKER = '[TRUNCATED]';
const REDACTION_MARKER = '[REDACTED]';

type TruncatedSnapshot = { truncated: true; bytes: number; preview: string };

function truncateSnapshot(json: string, bytes: number): TruncatedSnapshot {
  let low = 0;
  let high = json.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate: TruncatedSnapshot = {
      truncated: true,
      bytes,
      preview: `${json.slice(0, mid)}${TRUNCATION_MARKER}`,
    };
    if (Buffer.byteLength(JSON.stringify(candidate)) <= MAX_SNAPSHOT_BYTES) low = mid;
    else high = mid - 1;
  }
  return { truncated: true, bytes, preview: `${json.slice(0, low)}${TRUNCATION_MARKER}` };
}

function scrubSensitiveString(value: string): string {
  return value
    .replace(EMAIL_VALUE, REDACTION_MARKER)
    .replace(PHONE_VALUE, (candidate) => {
      const digits = candidate.replace(/\D/g, '');
      const isDate = /^\d{4}-\d{2}-\d{2}$/.test(candidate);
      return digits.length >= 7 && digits.length <= 15 && !isDate
        ? REDACTION_MARKER
        : candidate;
    })
    .replace(TOKEN_VALUE, REDACTION_MARKER);
}

/** Returns a detached, bounded snapshot with identity, free-text, and secret fields redacted. */
export function redactAuditSnapshot(value: unknown): unknown {
  try {
    const json = JSON.stringify(value, (key, nested) => {
      if (SENSITIVE_KEY.test(key)) return REDACTION_MARKER;
      if (typeof nested === 'string') return scrubSensitiveString(nested);
      if (typeof nested === 'bigint') return nested.toString();
      return nested;
    });
    if (json === undefined) return null;
    const bytes = Buffer.byteLength(json);
    if (bytes > MAX_SNAPSHOT_BYTES) return truncateSnapshot(json, bytes);
    return JSON.parse(json);
  } catch {
    throw new Error('Audit snapshots must be JSON-serializable');
  }
}

function actorId(actor: Actor): string {
  const id = actor.userId;
  if (!id) throw new Error('Audit actor requires a user ID');
  return id;
}

function auditEntry(actor: Actor, action: string, target: AuditTarget, before: unknown, after: unknown): AuditEntry {
  if (!action || !target.type || !target.id) throw new Error('Audit action and target are required');
  return {
    actor_id: actorId(actor),
    action,
    target_type: target.type,
    target_id: target.id,
    before: redactAuditSnapshot(before),
    after: redactAuditSnapshot(after),
  };
}

export function createAuditWriter(client: AuditClient) {
  return async (actor: Actor, action: string, target: AuditTarget, before: unknown, after: unknown): Promise<void> => {
    const { error } = await client.from('audit_log').insert(auditEntry(actor, action, target, before, after));
    if (error) throw new Error('Unable to write audit log');
  };
}

/** Records a server-side state transition using the service-role client. */
export async function audit(actor: Actor, action: string, target: AuditTarget, before: unknown, after: unknown): Promise<void> {
  const { supabaseService } = await import('@/lib/supabase/server');
  await createAuditWriter(supabaseService() as unknown as AuditClient)(actor, action, target, before, after);
}
