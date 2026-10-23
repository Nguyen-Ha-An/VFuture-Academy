import { describe, expect, it } from 'vitest';
import { migrateDocument } from '@/content-engine/compile/migrate';

describe('migrateDocument', () => {
  it('returns schema-v1 documents unchanged through the migration registry', () => {
    const document = { schemaVersion: 1, kind: 'lesson', id: 'intro' };
    expect(migrateDocument(document)).toEqual(document);
  });
});
