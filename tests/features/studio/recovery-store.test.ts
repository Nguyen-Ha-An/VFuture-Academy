import { beforeEach, describe, expect, it } from 'vitest';

import { decodeRawSourceRecovery } from '@/features/studio/content-transfer';
import {
  RECOVERY_EXPORT_KIND, RECOVERY_EXPORT_VERSION, RECOVERY_RECORD_VERSION, RECOVERY_TTL_MS,
  clearAccountRecovery, clearAcknowledgedRecovery, discardRecovery, loadRecovery, memoryRecoveryStorage,
  pruneRecovery, recoveryKey, saveRecovery, serverHasMovedOn, toRecoveryExport,
  claimTabId, currentTabId,
  type RecoveryRecord, type RecoveryScope, type RecoveryStorage, type TabClaimChannel,
} from '@/features/studio/recovery';

const scope: RecoveryScope = { accountId: 'author-1', scopeKey: 'central', courseId: 'minimal', tabId: 'tab-a' };
const snapshot = { sources: { course: '{"id":"minimal"', 'item:intro': '{}' }, baseUpdatedAt: '2026-09-06T00:00:00.000Z', baseVersionId: null };
const now = Date.parse('2026-09-07T09:00:00.000Z');

let storage: RecoveryStorage;
beforeEach(() => { storage = memoryRecoveryStorage(); });

describe('recovery record keys', () => {
  it('separates account, permission scope, course and tab', async () => {
    const keys = new Set([
      recoveryKey(scope),
      recoveryKey({ ...scope, accountId: 'author-2' }),
      recoveryKey({ ...scope, scopeKey: 'branch:hcm' }),
      recoveryKey({ ...scope, courseId: 'other' }),
      recoveryKey({ ...scope, tabId: 'tab-b' }),
    ]);
    expect(keys.size).toBe(5);
  });

  it('cannot be confused by identifiers that contain the separator', () => {
    expect(recoveryKey({ ...scope, accountId: 'a', courseId: 'b|c' }))
      .not.toBe(recoveryKey({ ...scope, accountId: 'a|b', courseId: 'c' }));
  });

  it('keeps two tabs on the same course independent', async () => {
    await saveRecovery(storage, scope, snapshot, now);
    await saveRecovery(storage, { ...scope, tabId: 'tab-b' }, { ...snapshot, sources: { course: 'other' } }, now);
    expect((await loadRecovery(storage, scope, now))?.sources).toEqual(snapshot.sources);
    expect((await loadRecovery(storage, { ...scope, tabId: 'tab-b' }, now))?.sources).toEqual({ course: 'other' });
  });

  it('does not read another account or scope', async () => {
    await saveRecovery(storage, scope, snapshot, now);
    expect(await loadRecovery(storage, { ...scope, accountId: 'author-2' }, now)).toBeNull();
    expect(await loadRecovery(storage, { ...scope, scopeKey: 'branch:hcm' }, now)).toBeNull();
    expect(await loadRecovery(storage, { ...scope, courseId: 'other' }, now)).toBeNull();
  });
});

describe('recovery record contents', () => {
  it('stores raw text, the base server revision and the modification time', async () => {
    const record = await saveRecovery(storage, scope, snapshot, now);
    expect(record).toMatchObject({
      version: RECOVERY_RECORD_VERSION,
      sources: snapshot.sources,
      baseUpdatedAt: snapshot.baseUpdatedAt,
      baseVersionId: null,
      modifiedAt: now,
    });
    expect(record.sources.course).toBe('{"id":"minimal"');
  });
});

describe('recovery expiry', () => {
  it('drops a record older than seven days on read', async () => {
    await saveRecovery(storage, scope, snapshot, now);
    const later = now + RECOVERY_TTL_MS + 1;
    expect(await loadRecovery(storage, scope, later)).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it('keeps a record inside the seven-day window', async () => {
    await saveRecovery(storage, scope, snapshot, now);
    expect(await loadRecovery(storage, scope, now + RECOVERY_TTL_MS - 1)).not.toBeNull();
  });

  it('drops records written by an older store version', async () => {
    const stale: RecoveryRecord = { ...scope, ...snapshot, version: 0, key: recoveryKey(scope), sources: {}, modifiedAt: now };
    await storage.write(stale);
    expect(await loadRecovery(storage, scope, now)).toBeNull();
  });

  it('prunes every expired record across accounts', async () => {
    await saveRecovery(storage, scope, snapshot, now);
    await saveRecovery(storage, { ...scope, accountId: 'author-2' }, snapshot, now - RECOVERY_TTL_MS - 1);
    expect(await pruneRecovery(storage, now)).toBe(1);
    expect((await storage.list()).map(record => record.accountId)).toEqual(['author-1']);
  });
});

describe('clearing recovery', () => {
  it('clears only the acknowledged snapshot, so edits made during a save survive', async () => {
    await saveRecovery(storage, scope, snapshot, now);
    const newer = { ...snapshot, sources: { ...snapshot.sources, 'item:intro': '{"title":"typed while saving"}' } };
    await saveRecovery(storage, scope, newer, now + 10);

    expect(await clearAcknowledgedRecovery(storage, scope, snapshot.sources)).toBe(false);
    expect((await loadRecovery(storage, scope, now + 20))?.sources).toEqual(newer.sources);

    expect(await clearAcknowledgedRecovery(storage, scope, newer.sources)).toBe(true);
    expect(await loadRecovery(storage, scope, now + 20)).toBeNull();
  });

  it('treats an added or removed document as a different snapshot', async () => {
    await saveRecovery(storage, scope, snapshot, now);
    const { course } = snapshot.sources;
    expect(await clearAcknowledgedRecovery(storage, scope, { course })).toBe(false);
    expect(await clearAcknowledgedRecovery(storage, scope, { ...snapshot.sources, 'item:extra': '{}' })).toBe(false);
  });

  it('discards this tab only', async () => {
    await saveRecovery(storage, scope, snapshot, now);
    await saveRecovery(storage, { ...scope, tabId: 'tab-b' }, snapshot, now);
    await discardRecovery(storage, scope);
    expect(await loadRecovery(storage, scope, now)).toBeNull();
    expect(await loadRecovery(storage, { ...scope, tabId: 'tab-b' }, now)).not.toBeNull();
  });

  it('clears every record of the signed-out account and nobody else', async () => {
    await saveRecovery(storage, scope, snapshot, now);
    await saveRecovery(storage, { ...scope, courseId: 'other', tabId: 'tab-b' }, snapshot, now);
    await saveRecovery(storage, { ...scope, accountId: 'author-2' }, snapshot, now);
    expect(await clearAccountRecovery(storage, 'author-1')).toBe(2);
    expect((await storage.list()).map(record => record.accountId)).toEqual(['author-2']);
  });
});

describe('protecting newer server revisions', () => {
  const record = (baseUpdatedAt: string | null): RecoveryRecord =>
    ({ ...scope, version: RECOVERY_RECORD_VERSION, key: recoveryKey(scope), sources: {}, baseUpdatedAt, baseVersionId: null, modifiedAt: now });

  it('accepts a record based on the current revision', () => {
    expect(serverHasMovedOn(record('2026-09-06T00:00:00.000Z'), '2026-09-06T00:00:00.000Z')).toBe(false);
  });

  it('accepts differing text for the same instant', () => {
    expect(serverHasMovedOn(record('2026-09-06T00:00:00.000Z'), '2026-09-06T00:00:00Z')).toBe(false);
  });

  it('flags a record based on an older revision', () => {
    expect(serverHasMovedOn(record('2026-09-06T00:00:00.000Z'), '2026-09-06T10:00:00.000Z')).toBe(true);
  });

  it('flags unparseable or missing revisions instead of assuming they match', () => {
    expect(serverHasMovedOn(record(null), '2026-09-06T00:00:00.000Z')).toBe(true);
    expect(serverHasMovedOn(record('not-a-date'), '2026-09-06T00:00:00.000Z')).toBe(true);
    expect(serverHasMovedOn(record('2026-09-06T00:00:00.000Z'), null)).toBe(true);
  });
});

describe('versioned raw-source recovery envelope', () => {
  it('round-trips a stored record through the one shared codec', async () => {
    const record = await saveRecovery(storage, scope, snapshot, now);
    const exported = toRecoveryExport(record);
    expect(exported).toMatchObject({ version: RECOVERY_EXPORT_VERSION, kind: RECOVERY_EXPORT_KIND, courseId: 'minimal' });

    const parsed = decodeRawSourceRecovery(JSON.stringify(exported));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toMatchObject({
      courseId: 'minimal',
      sources: snapshot.sources,
      baseVersionId: null,
      baseUpdatedAt: snapshot.baseUpdatedAt,
    });
  });

  it('has no second, laxer parser of its own', async () => {
    const recovery = await import('@/features/studio/recovery');
    // `decodeRawSourceRecovery` is the only way a recovery envelope enters the app.
    expect('parseRecoveryExport' in recovery).toBe(false);
  });
});

describe('records that cannot be trusted are dropped, not partly used', () => {
  const stored = (overrides: Partial<RecoveryRecord>): RecoveryRecord =>
    ({ ...scope, version: RECOVERY_RECORD_VERSION, key: recoveryKey(scope), sources: { course: '{}' }, baseUpdatedAt: null, baseVersionId: null, modifiedAt: now, ...overrides });

  const rejected = async (record: RecoveryRecord) => {
    await storage.write(record);
    expect(await loadRecovery(storage, scope, now)).toBeNull();
  };

  it('drops a record whose sources use the legacy `manifest` key', async () => {
    // Slicing a prefix off `manifest` would invent an item called `est`.
    await rejected(stored({ sources: { manifest: '{}', 'item:intro': '{}' } as Record<string, string> }));
  });

  it('drops a record with an empty or malformed item key', async () => {
    await rejected(stored({ sources: { course: '{}', 'item:': '{}' } }));
    await storage.remove([recoveryKey(scope)]);
    await rejected(stored({ sources: { course: '{}', 'item:Not Valid': '{}' } }));
    await storage.remove([recoveryKey(scope)]);
    await rejected(stored({ sources: { course: '{}', 'something-else': '{}' } }));
  });

  it('drops a record with no course source', async () => {
    await rejected(stored({ sources: { 'item:intro': '{}' } }));
  });

  it('drops a record whose sources are not raw text', async () => {
    await rejected(stored({ sources: { course: { id: 'minimal' } } as unknown as Record<string, string> }));
  });

  it('drops a record missing its own scope fields', async () => {
    await rejected(stored({ accountId: '' }));
    await storage.remove([recoveryKey(scope)]);
    await rejected(stored({ courseId: undefined as unknown as string }));
  });

  it('drops a record with a non-string base revision', async () => {
    await rejected(stored({ baseUpdatedAt: 42 as unknown as string }));
  });

  it('keeps a well-formed record', async () => {
    await storage.write(stored({ sources: { course: '{"id":"minimal"', 'item:intro': '{}' } }));
    expect(await loadRecovery(storage, scope, now)).not.toBeNull();
  });
});

describe('storage failures', () => {
  it('propagates a write failure so the caller can surface it', async () => {
    const failing: RecoveryStorage = { ...memoryRecoveryStorage(), write: () => Promise.reject(new Error('QuotaExceededError')) };
    await expect(saveRecovery(failing, scope, snapshot, now)).rejects.toThrow('QuotaExceededError');
  });

  it('propagates a read failure', async () => {
    const failing: RecoveryStorage = { ...memoryRecoveryStorage(), read: () => Promise.reject(new Error('blocked')) };
    await expect(loadRecovery(failing, scope, now)).rejects.toThrow('blocked');
  });
});

describe('tab identity and ownership', () => {
  const STORED = 'vfuture:studio:recovery-tab';
  const fakeStorage = (initial: Record<string, string> = {}): Storage => {
    const rows = new Map(Object.entries(initial));
    return {
      getItem: key => rows.get(key) ?? null,
      setItem: (key, value) => { rows.set(key, value); },
      removeItem: key => { rows.delete(key); },
      clear: () => rows.clear(),
      key: index => [...rows.keys()][index] ?? null,
      get length() { return rows.size; },
    } as Storage;
  };

  /** One shared bus; like a real BroadcastChannel, a channel never hears itself. */
  function bus() {
    const listeners = new Set<(event: { data: unknown }) => void>();
    return () => {
      const own = new Set<(event: { data: unknown }) => void>();
      return {
        postMessage: (data: unknown) => { for (const listener of listeners) if (!own.has(listener)) listener({ data }); },
        addEventListener: (_type: 'message', listener: (event: { data: unknown }) => void) => { own.add(listener); listeners.add(listener); },
        removeEventListener: (_type: 'message', listener: (event: { data: unknown }) => void) => { own.delete(listener); listeners.delete(listener); },
        close: () => { for (const listener of own) listeners.delete(listener); own.clear(); },
      } satisfies TabClaimChannel;
    };
  }

  const ids = (prefix: string) => { let n = 0; return () => `${prefix}-${++n}`; };

  it('reuses the stored identity across a reload in the same tab', () => {
    const storage = fakeStorage();
    const first = currentTabId(storage, () => 'tab-1');
    expect(currentTabId(storage, () => 'tab-2')).toBe(first);
  });

  it('keeps the stored identity when nobody else holds it', async () => {
    const channel = bus();
    const storage = fakeStorage({ [STORED]: 'tab-1' });
    const owned = await claimTabId({ storage, channel: channel(), timeoutMs: 5, newId: ids('a') });
    expect(owned).toMatchObject({ tabId: 'tab-1', rekeyed: false, durable: true, priorTabId: null });
    owned.dispose();
  });

  it('re-keys a duplicate opened long after the first tab finished its handshake', async () => {
    const channel = bus();
    // First tab settles into ownership.
    const first = await claimTabId({ storage: fakeStorage({ [STORED]: 'tab-1' }), channel: channel(), timeoutMs: 5, newId: ids('first') });
    expect(first.tabId).toBe('tab-1');

    // Later, a duplicate opens with the copied sessionStorage. The first tab is
    // still mounted, so its responder must still be listening.
    const duplicate = fakeStorage({ [STORED]: 'tab-1' });
    const second = await claimTabId({ storage: duplicate, channel: channel(), timeoutMs: 20, newId: ids('second') });

    expect(second.rekeyed).toBe(true);
    expect(second.tabId).not.toBe('tab-1');
    expect(duplicate.getItem(STORED)).toBe(second.tabId);
    expect(first.tabId).toBe('tab-1');
    first.dispose(); second.dispose();
  });

  it('stops defending the identity once the editor unmounts', async () => {
    const channel = bus();
    const first = await claimTabId({ storage: fakeStorage({ [STORED]: 'tab-1' }), channel: channel(), timeoutMs: 5, newId: ids('first') });
    first.dispose();

    const reopened = await claimTabId({ storage: fakeStorage({ [STORED]: 'tab-1' }), channel: channel(), timeoutMs: 20, newId: ids('second') });
    expect(reopened).toMatchObject({ tabId: 'tab-1', rekeyed: false });
    reopened.dispose();
  });

  it('separates two simultaneous claims deterministically, by nonce', async () => {
    const channel = bus();
    const left = fakeStorage({ [STORED]: 'tab-1' });
    const right = fakeStorage({ [STORED]: 'tab-1' });
    const [a, b] = await Promise.all([
      claimTabId({ storage: left, channel: channel(), timeoutMs: 25, newId: ids('aaa') }),
      claimTabId({ storage: right, channel: channel(), timeoutMs: 25, newId: ids('zzz') }),
    ]);
    expect(a.tabId).not.toBe(b.tabId);
    // The lower nonce keeps the stored identity, regardless of message order.
    expect(a.tabId).toBe('tab-1');
    expect(b.rekeyed).toBe(true);
    a.dispose(); b.dispose();
  });

  it('writes under a fresh identity when uniqueness cannot be checked, and still offers the prior record', async () => {
    const storage = fakeStorage({ [STORED]: 'tab-1' });
    const owned = await claimTabId({ storage, channel: null, newId: ids('fresh') });
    expect(owned.durable).toBe(false);
    expect(owned.tabId).not.toBe('tab-1');
    expect(owned.priorTabId).toBe('tab-1');
    expect(storage.getItem(STORED)).toBe(owned.tabId);
  });

  it('falls back to a per-mount identity when sessionStorage throws', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(currentTabId(broken, () => 'tab-fresh')).toBe('tab-fresh');
  });
});
