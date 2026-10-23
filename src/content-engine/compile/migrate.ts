import { CURRENT_SCHEMA_VERSION } from '../schema/common';

export type DocumentMigrator = (document: Record<string, unknown>) => Record<string, unknown>;

/** Schema migrations are keyed by their input version. Version 1 is identity today. */
export const MIGRATORS: Readonly<Record<number, DocumentMigrator>> = {
  1: (document) => document,
};

export function migrateDocument<T>(document: T): T {
  if (typeof document !== 'object' || document === null) return document;
  const raw = document as Record<string, unknown>;
  if (raw.schemaVersion !== CURRENT_SCHEMA_VERSION) return document;
  return MIGRATORS[CURRENT_SCHEMA_VERSION](raw) as T;
}
