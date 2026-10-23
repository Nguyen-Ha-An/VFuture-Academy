import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: {} as unknown }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mocks.client }));
import { withDisposableResource } from '../e2e/support/resource-fixture';

afterEach(() => { vi.unstubAllEnvs(); });

describe('resource fixture namespace boundary', () => {
  it('never enters cleanup or mutation when the generated resource ID already exists', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://rpggoukinvxuxuxjodkt.supabase.co');
    vi.stubEnv('SEED_DEV_PROJECT_REF', 'rpggoukinvxuxuxjodkt');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'unit-test-only');
    vi.stubEnv('SEED_ADMIN_EMAIL', 'admin@unit.example');
    const remove = vi.fn(); const deleteRows = vi.fn(); const run = vi.fn();
    const from = vi.fn((table: string) => {
      const query = {
        select: vi.fn(() => query), eq: vi.fn(() => query), delete: deleteRows,
        maybeSingle: vi.fn(async () => ({ data: table === 'resources' ? { id: 'pre-existing' } : null, error: null })),
      };
      return query;
    });
    mocks.client = {
      from, storage: { from: remove },
      auth: { admin: { listUsers: async () => ({ data: { users: [{ id: 'owner', email: 'admin@unit.example' }] }, error: null }) } },
    };
    await expect(withDisposableResource(run)).rejects.toThrow('namespace is not empty');
    expect(run).not.toHaveBeenCalled();
    expect(from.mock.calls.map(([table]) => table)).toEqual(['resources', 'media_assets']);
    expect(deleteRows).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
