import { describe, expect, it } from 'vitest';

import {
  RECOVERY_DB_NAME, RECOVERY_DB_VERSION, RECOVERY_STORE_NAME, RecoveryStorageUnavailableError,
  indexedDbRecoveryStorage, recoveryKey, type RecoveryRecord,
} from '@/features/studio/recovery';

const scope = { accountId: 'author-1', scopeKey: 'central', courseId: 'minimal', tabId: 'tab-a' };
const record = (overrides: Partial<RecoveryRecord> = {}): RecoveryRecord => ({
  ...scope, version: 1, key: recoveryKey(scope), sources: { course: '{"id":"minimal"' },
  baseUpdatedAt: '2026-09-06T00:00:00.000Z', baseVersionId: null, modifiedAt: 1, ...overrides,
});

/**
 * A deliberately small IndexedDB stand-in: enough of the asynchronous request and
 * transaction protocol to exercise the adapter's wiring, with switches for the two
 * failures that matter in practice (open refused, write over quota).
 */
function fakeIndexedDb(options: { failOpen?: boolean; failWrite?: boolean; blocked?: boolean } = {}) {
  const rows = new Map<string, RecoveryRecord>();
  const created: string[] = [];
  let closed = 0;
  const fire = <T>(target: { onsuccess?: (() => void) | null; onerror?: (() => void) | null; result?: T; error?: unknown }, ok: boolean, value?: T, error?: unknown) => {
    queueMicrotask(() => { if (ok) { target.result = value; target.onsuccess?.(); } else { target.error = error; target.onerror?.(); } });
    return target;
  };
  const request = <T>(ok: boolean, value?: T, error?: unknown) => fire<T>({ onsuccess: null, onerror: null } as never, ok, value, error) as unknown as IDBRequest<T>;
  const factory = {
    open: () => {
      const openRequest = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: undefined, error: undefined } as unknown as IDBOpenDBRequest & Record<string, unknown>;
      queueMicrotask(() => {
        if (options.blocked) { (openRequest.onblocked as (() => void) | null)?.(); return; }
        if (options.failOpen) { (openRequest as { error?: unknown }).error = new Error('refused'); (openRequest.onerror as (() => void) | null)?.(); return; }
        const store = {
          createIndex: (name: string) => { created.push(name); },
          get: (key: string) => request<RecoveryRecord | undefined>(true, rows.get(key)),
          getAll: () => request<RecoveryRecord[]>(true, [...rows.values()]),
          put: (value: RecoveryRecord) => options.failWrite
            ? request(false, undefined, new Error('QuotaExceededError'))
            : (rows.set(value.key, value), request(true, value.key)),
          delete: (key: string) => (rows.delete(key), request(true, undefined)),
        };
        const database = {
          objectStoreNames: { contains: () => created.length > 0 },
          createObjectStore: () => store,
          deleteObjectStore: () => undefined,
          close: () => { closed += 1; },
          transaction: () => {
            const transaction = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, onerror: null as (() => void) | null, error: undefined as unknown, objectStore: () => store };
            // A macrotask, so every awaited request inside the operation has settled first.
            setTimeout(() => transaction.oncomplete?.(), 0);
            return transaction;
          },
        };
        (openRequest as { result?: unknown }).result = database;
        (openRequest.onupgradeneeded as (() => void) | null)?.();
        (openRequest.onsuccess as (() => void) | null)?.();
      });
      return openRequest;
    },
  } as unknown as IDBFactory;
  return { factory, rows, created, closedCount: () => closed };
}

describe('IndexedDB recovery storage', () => {
  it('names a versioned database, store and account index', () => {
    expect({ RECOVERY_DB_NAME, RECOVERY_DB_VERSION, RECOVERY_STORE_NAME })
      .toEqual({ RECOVERY_DB_NAME: 'vfuture-studio-recovery', RECOVERY_DB_VERSION: 1, RECOVERY_STORE_NAME: 'drafts' });
  });

  it('writes, reads, lists and removes records', async () => {
    const fake = fakeIndexedDb();
    const storage = indexedDbRecoveryStorage(fake.factory);
    await storage.write(record());
    expect(fake.created).toContain('by-account');
    expect(await storage.read(recoveryKey(scope))).toMatchObject({ sources: { course: '{"id":"minimal"' } });
    expect(await storage.list()).toHaveLength(1);
    await storage.remove([recoveryKey(scope)]);
    expect(await storage.read(recoveryKey(scope))).toBeNull();
  });

  it('returns null rather than throwing for an absent record', async () => {
    const storage = indexedDbRecoveryStorage(fakeIndexedDb().factory);
    expect(await storage.read('missing')).toBeNull();
  });

  it('closes its connection after every operation', async () => {
    const fake = fakeIndexedDb();
    const storage = indexedDbRecoveryStorage(fake.factory);
    await storage.write(record());
    await storage.read(recoveryKey(scope));
    expect(fake.closedCount()).toBe(2);
  });

  it('reports a quota failure instead of silently dropping the record', async () => {
    const storage = indexedDbRecoveryStorage(fakeIndexedDb({ failWrite: true }).factory);
    await expect(storage.write(record())).rejects.toThrow();
  });

  it('reports a refused or blocked database', async () => {
    await expect(indexedDbRecoveryStorage(fakeIndexedDb({ failOpen: true }).factory).list())
      .rejects.toBeInstanceOf(RecoveryStorageUnavailableError);
    await expect(indexedDbRecoveryStorage(fakeIndexedDb({ blocked: true }).factory).list())
      .rejects.toBeInstanceOf(RecoveryStorageUnavailableError);
  });

  it('reports unavailability when the environment has no IndexedDB', async () => {
    await expect(indexedDbRecoveryStorage(undefined).read('key')).rejects.toBeInstanceOf(RecoveryStorageUnavailableError);
    await expect(indexedDbRecoveryStorage(undefined).removeIfSources('key', {})).rejects.toBeInstanceOf(RecoveryStorageUnavailableError);
  });

  it('compares and deletes in a single transaction', async () => {
    const fake = fakeIndexedDb();
    const storage = indexedDbRecoveryStorage(fake.factory);
    await storage.write(record({ sources: { course: 'a' } }));

    expect(await storage.removeIfSources(recoveryKey(scope), { course: 'b' })).toBe(false);
    expect(await storage.read(recoveryKey(scope))).not.toBeNull();

    expect(await storage.removeIfSources(recoveryKey(scope), { course: 'a' })).toBe(true);
    expect(await storage.read(recoveryKey(scope))).toBeNull();
    expect(await storage.removeIfSources(recoveryKey(scope), { course: 'a' })).toBe(false);
  });
});
