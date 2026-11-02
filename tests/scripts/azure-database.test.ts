import { describe, expect, it } from 'vitest';
import { buildAzureSchema } from '../../scripts/azure-core/schema.mjs';
describe('Azure schema derivation', () => {
  it('retains owned SQL contracts without vendor auth or storage schemas', () => {
    const result = buildAzureSchema();
    expect(result.sql).toContain('references academy_identity.users(id)');
    expect(result.sql).toContain('create function public.media_upload_reserve');
    expect(result.sql).toContain('academy_private.storage_objects');
    expect(result.sql).not.toMatch(/\b(?:storage\.(?:objects|buckets)|auth\.users|vault\.|net\.)/);
    expect(result.receipt.migrations.length).toBeGreaterThan(40);
    expect(result.receipt.omissions).toHaveLength(3);
  });
});
