import { sameSources } from './store-compare';
import type { RecoveryRecord, RecoveryStorage } from './types';

export const RECOVERY_DB_NAME = 'vfuture-studio-recovery';
/** Object-store version. Upgrades recreate the store rather than migrate guesses. */
export const RECOVERY_DB_VERSION = 1;
export const RECOVERY_STORE_NAME = 'drafts';

export class RecoveryStorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Local recovery storage is unavailable');
    this.name = 'RecoveryStorageUnavailableError';
    this.cause = cause;
  }
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new RecoveryStorageUnavailableError('request failed'));
  });
}

function openAt(factory: IDBFactory, version: number | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = version === undefined ? factory.open(RECOVERY_DB_NAME) : factory.open(RECOVERY_DB_NAME, version); }
    catch (cause) { reject(new RecoveryStorageUnavailableError(cause)); return; }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(RECOVERY_STORE_NAME)) db.deleteObjectStore(RECOVERY_STORE_NAME);
      db.createObjectStore(RECOVERY_STORE_NAME, { keyPath: 'key' }).createIndex('by-account', 'accountId');
    };
    request.onblocked = () => reject(new RecoveryStorageUnavailableError('blocked'));
    request.onerror = () => reject(new RecoveryStorageUnavailableError(request.error));
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Opens the store, repairing the one case that would otherwise wedge recovery for
 * good: a database of the same name that already exists at this version but has no
 * object store — created, for instance, by an un-versioned `indexedDB.open` from
 * other code on the origin. Reopening one version higher runs the upgrade that
 * creates the store instead of failing every operation from then on.
 */
async function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const db = await openAt(factory, RECOVERY_DB_VERSION);
  if (db.objectStoreNames.contains(RECOVERY_STORE_NAME)) return db;
  const version = db.version;
  db.close();
  const upgraded = await openAt(factory, version + 1);
  if (!upgraded.objectStoreNames.contains(RECOVERY_STORE_NAME)) {
    upgraded.close();
    throw new RecoveryStorageUnavailableError('object store missing');
  }
  return upgraded;
}

/**
 * IndexedDB-backed store. Each call opens and closes its own connection so an
 * unrelated tab holding a version-change transaction cannot wedge this one, and so
 * a failure is reported per operation instead of poisoning the whole session.
 *
 * Every operation awaits the transaction, not just its requests: a request can
 * succeed and the transaction still abort (quota is charged at commit), and an
 * unawaited transaction promise would surface that as an unhandled rejection.
 */
export function indexedDbRecoveryStorage(factory: IDBFactory | undefined = globalThis.indexedDB): RecoveryStorage {
  if (!factory) {
    const unavailable = () => Promise.reject(new RecoveryStorageUnavailableError('no indexedDB'));
    return { read: unavailable, write: unavailable, remove: unavailable, list: unavailable, removeIfSources: unavailable };
  }
  const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> => {
    const db = await openDatabase(factory);
    try {
      const transaction = db.transaction(RECOVERY_STORE_NAME, mode);
      let settled = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(new RecoveryStorageUnavailableError(transaction.error));
        transaction.onerror = () => reject(new RecoveryStorageUnavailableError(transaction.error));
      });
      // Claim the rejection immediately; it is re-awaited below once `run` settles.
      settled = settled.catch((cause: unknown) => { throw cause instanceof Error ? cause : new RecoveryStorageUnavailableError(cause); });
      let result: T;
      try { result = await run(transaction.objectStore(RECOVERY_STORE_NAME)); }
      catch (cause) { settled.catch(() => undefined); throw cause; }
      await settled;
      return result;
    } finally { db.close(); }
  };
  return {
    read: key => withStore('readonly', async store => (await promisify<RecoveryRecord | undefined>(store.get(key))) ?? null),
    write: record => withStore('readwrite', async store => { await promisify(store.put(record)); }),
    remove: keys => withStore('readwrite', async store => { for (const key of keys) await promisify(store.delete(key)); }),
    list: () => withStore('readonly', store => promisify<RecoveryRecord[]>(store.getAll())),
    // One readwrite transaction spans the read and the delete, so a write from
    // another task cannot slip between them and be discarded.
    removeIfSources: (key, sources) => withStore('readwrite', async store => {
      const stored = await promisify<RecoveryRecord | undefined>(store.get(key));
      if (!stored || !sameSources(stored.sources, sources)) return false;
      await promisify(store.delete(key));
      return true;
    }),
  };
}

/**
 * Session-lifetime fallback. It cannot survive a reload, so it is only ever a
 * degraded mode: the author is told that recovery storage is unavailable and the
 * Download action stays the durable escape hatch.
 */
export function memoryRecoveryStorage(): RecoveryStorage {
  const records = new Map<string, RecoveryRecord>();
  return {
    read: key => Promise.resolve(records.get(key) ?? null),
    write: record => { records.set(record.key, record); return Promise.resolve(); },
    remove: keys => { for (const key of keys) records.delete(key); return Promise.resolve(); },
    list: () => Promise.resolve([...records.values()]),
    removeIfSources: (key, sources) => {
      const stored = records.get(key);
      if (!stored || !sameSources(stored.sources, sources)) return Promise.resolve(false);
      records.delete(key);
      return Promise.resolve(true);
    },
  };
}
