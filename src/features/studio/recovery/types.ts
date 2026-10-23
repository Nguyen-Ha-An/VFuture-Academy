/**
 * Local recovery keeps unfinished raw editor text on the author's own device so a
 * refresh, crash or accidental navigation cannot lose work that the server refuses
 * to store because it is still invalid. Nothing here ever reaches the server, and
 * nothing here is authoritative: the server draft always wins unless the author
 * explicitly restores.
 */

/** Bumped when the stored shape changes; older records are dropped instead of guessed at. */
export const RECOVERY_RECORD_VERSION = 1;
/** Downloaded/imported raw-source envelope version. Independent of the store version. */
export const RECOVERY_EXPORT_VERSION = 1;
export const RECOVERY_EXPORT_KIND = 'vfuture.studio.raw-sources';
export const RECOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECOVERY_DEBOUNCE_MS = 300;

/**
 * Records are keyed by account, permission scope, course and tab. Two tabs editing
 * the same course keep independent records, and one account never reads another's.
 */
export type RecoveryScope = {
  accountId: string;
  scopeKey: string;
  courseId: string;
  tabId: string;
};

export type RecoveryRecord = RecoveryScope & {
  version: number;
  key: string;
  /** Raw editor text exactly as typed, keyed by `refKey(DocumentRef)`. */
  sources: Record<string, string>;
  /** Server draft revision the edits were based on. */
  baseUpdatedAt: string | null;
  baseVersionId: string | null;
  /** Wall-clock write time, used for the seven-day expiry and for display. */
  modifiedAt: number;
};

/**
 * Storage port. The IndexedDB adapter is one implementation; tests and any
 * environment without IndexedDB supply another. Every method may reject — quota,
 * private-browsing and blocked-storage failures are surfaced, never swallowed.
 */
export type RecoveryStorage = {
  read(key: string): Promise<RecoveryRecord | null>;
  write(record: RecoveryRecord): Promise<void>;
  remove(keys: readonly string[]): Promise<void>;
  list(): Promise<RecoveryRecord[]>;
  /**
   * Compare-and-delete in one transaction. A separate read-then-remove could drop
   * text typed between the two steps, which is exactly the text recovery exists to
   * keep. Resolves `true` only when the stored sources matched and were removed.
   */
  removeIfSources(key: string, sources: Record<string, string>): Promise<boolean>;
};

/**
 * Versioned raw-source envelope for Download and for explicit recovery import.
 * The shape, its encoder and its only decoder live in
 * `src/features/studio/content-transfer.ts`.
 */
export type { RawSourceEnvelope as RecoveryExport } from '../content-transfer';
