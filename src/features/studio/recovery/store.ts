import { encodeRawSourceRecovery } from '../content-transfer';
import { validSourceKeys } from './store-compare';
import {
  RECOVERY_RECORD_VERSION, RECOVERY_TTL_MS,
  type RecoveryExport, type RecoveryRecord, type RecoveryScope, type RecoveryStorage,
} from './types';

/**
 * JSON encoding, not string concatenation: course and account identifiers may
 * contain any character, and two different scopes must never share a key.
 */
export function recoveryKey(scope: RecoveryScope): string {
  return JSON.stringify([RECOVERY_RECORD_VERSION, scope.accountId, scope.scopeKey, scope.courseId, scope.tabId]);
}

/**
 * A stored record is only usable when everything it is keyed and read by is intact:
 * the store version, its own scope fields, a sane modification time inside the
 * seven-day window, and a `sources` map keyed exactly the way the editor writes it.
 * Anything else is dropped rather than partially trusted.
 */
function usable(record: RecoveryRecord | null, now: number): boolean {
  if (record === null) return false;
  if (record.version !== RECOVERY_RECORD_VERSION) return false;
  if (!Number.isFinite(record.modifiedAt) || now - record.modifiedAt >= RECOVERY_TTL_MS) return false;
  const scopeFields = [record.accountId, record.scopeKey, record.courseId, record.tabId, record.key];
  if (scopeFields.some(field => typeof field !== 'string' || field.length === 0)) return false;
  if (record.baseUpdatedAt !== null && typeof record.baseUpdatedAt !== 'string') return false;
  if (record.baseVersionId !== null && typeof record.baseVersionId !== 'string') return false;
  return validSourceKeys(record.sources);
}

/** Reads this tab's record, dropping anything expired or written by an older version. */
export async function loadRecovery(storage: RecoveryStorage, scope: RecoveryScope, now = Date.now()): Promise<RecoveryRecord | null> {
  const key = recoveryKey(scope);
  const record = await storage.read(key);
  if (record === null) return null;
  if (!usable(record, now)) { await storage.remove([key]); return null; }
  return record;
}

export async function saveRecovery(
  storage: RecoveryStorage,
  scope: RecoveryScope,
  snapshot: { sources: Record<string, string>; baseUpdatedAt: string | null; baseVersionId: string | null },
  now = Date.now(),
): Promise<RecoveryRecord> {
  const record: RecoveryRecord = {
    ...scope,
    version: RECOVERY_RECORD_VERSION,
    key: recoveryKey(scope),
    sources: { ...snapshot.sources },
    baseUpdatedAt: snapshot.baseUpdatedAt,
    baseVersionId: snapshot.baseVersionId,
    modifiedAt: now,
  };
  await storage.write(record);
  return record;
}

export async function discardRecovery(storage: RecoveryStorage, scope: RecoveryScope): Promise<void> {
  await storage.remove([recoveryKey(scope)]);
}

/**
 * Clears the record only when it still holds exactly the text the server
 * acknowledged. Anything typed while the save was in flight is newer than the
 * acknowledgement and stays recoverable.
 */
export async function clearAcknowledgedRecovery(
  storage: RecoveryStorage,
  scope: RecoveryScope,
  acknowledged: Record<string, string>,
): Promise<boolean> {
  return storage.removeIfSources(recoveryKey(scope), acknowledged);
}

/** Sign-out and account switches clear that account's own records and nobody else's. */
export async function clearAccountRecovery(storage: RecoveryStorage, accountId: string): Promise<number> {
  const records = await storage.list();
  const keys = records.filter(record => record.accountId === accountId).map(record => record.key);
  if (keys.length) await storage.remove(keys);
  return keys.length;
}

export async function pruneRecovery(storage: RecoveryStorage, now = Date.now()): Promise<number> {
  const records = await storage.list();
  const keys = records.filter(record => !usable(record, now)).map(record => record.key);
  if (keys.length) await storage.remove(keys);
  return keys.length;
}

/**
 * A record based on an older server revision must never be applied on its own.
 * Unparseable or mismatched revisions count as diverged rather than equal, so the
 * author is warned instead of silently overwriting newer server content.
 */
export function serverHasMovedOn(record: RecoveryRecord, currentUpdatedAt: string | null): boolean {
  if (record.baseUpdatedAt === currentUpdatedAt) return false;
  const base = record.baseUpdatedAt === null ? NaN : Date.parse(record.baseUpdatedAt);
  const current = currentUpdatedAt === null ? NaN : Date.parse(currentUpdatedAt);
  if (Number.isNaN(base) || Number.isNaN(current)) return true;
  return current !== base;
}

/**
 * Download shape for a stored record. Both the envelope and its decoder live in
 * `content-transfer`, so there is exactly one raw-source recovery format and one
 * implementation that reads it — `decodeRawSourceRecovery` is the only entry point
 * for importing one back.
 */
export function toRecoveryExport(record: RecoveryRecord): RecoveryExport {
  return encodeRawSourceRecovery(record.courseId, record.sources, record.baseVersionId, {
    baseUpdatedAt: record.baseUpdatedAt,
    modifiedAt: new Date(record.modifiedAt).toISOString(),
  });
}
