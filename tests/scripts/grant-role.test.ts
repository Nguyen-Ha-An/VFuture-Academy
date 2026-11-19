import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createServiceClient: vi.fn() }));

vi.mock('../../src/lib/supabase/service-client', () => ({ createServiceClient: mocks.createServiceClient }));

const userId = '00000000-0000-4000-8000-000000000101';
const email = 'admin@example.com';
const centralGrant = { userId, email, role: 'central_admin' as const };

describe('grant-role script', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('parses valid arguments and rejects unknown roles before client creation', async () => {
    const { parseGrantRoleArguments } = await import('../../scripts/grant-role');
    expect(parseGrantRoleArguments([userId, email, 'admin', 'vinsmc'])).toEqual({ userId, email, role: 'admin', branchId: 'vinsmc' });
    expect(() => parseGrantRoleArguments([email, 'central_admin'])).toThrow('Usage: npm run grant-role');
    expect(() => parseGrantRoleArguments([userId, email, 'owner'])).toThrow('Usage: npm run grant-role');
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('uses the script-safe service client to grant a validated role', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const getUserById = vi.fn().mockResolvedValue({ data: { user: { id: userId, email, email_confirmed_at: '2026-11-01T00:00:00Z' } }, error: null });
    const service = {
      auth: { admin: { getUserById } },
      from: vi.fn(() => ({ upsert })),
    };
    mocks.createServiceClient.mockReturnValue(service);
    const { grantRole } = await import('../../scripts/grant-role');

    await grantRole(centralGrant);

    expect(mocks.createServiceClient).toHaveBeenCalledWith('https://example.supabase.co', 'service-key');
    expect(getUserById).toHaveBeenCalledWith(userId);
    expect(service.from).toHaveBeenCalledWith('role_assignments');
    expect(service.from).not.toHaveBeenCalledWith('user_roles');
    expect(upsert).toHaveBeenCalledWith({ user_id: userId, role_definition_id: 'central_admin', branch_id: null }, { onConflict: 'user_id,role_definition_id,branch_id' });
  });

  it.each([
    { id: userId, email },
    { id: userId, email: 'other@example.com', email_confirmed_at: '2026-11-01T00:00:00Z' },
    { id: '00000000-0000-4000-8000-000000000102', email, email_confirmed_at: '2026-11-01T00:00:00Z' },
  ])('refuses unverified or mismatched identities before any write', async user => {
    const from = vi.fn();
    mocks.createServiceClient.mockReturnValue({ auth: { admin: { getUserById: async () => ({ data: { user }, error: null }) } }, from });
    const { grantRole } = await import('../../scripts/grant-role');
    await expect(grantRole(centralGrant)).rejects.toThrow('verified');
    expect(from).not.toHaveBeenCalled();
  });

  it('preserves an existing school membership on a role grant', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const user = { id: userId, email, email_confirmed_at: '2026-11-01T00:00:00Z' };
    mocks.createServiceClient.mockReturnValue({
      auth: { admin: { getUserById: async () => ({ data: { user }, error: null }) } },
      from: () => ({ upsert }),
    });
    const { grantRole } = await import('../../scripts/grant-role');
    await grantRole({ userId, email, role: 'teacher', branchId: 'school-one' });
    expect(upsert).toHaveBeenNthCalledWith(1, { user_id: userId, branch_id: 'school-one', status: 'active' }, { onConflict: 'user_id,branch_id', ignoreDuplicates: true });
  });

  it('requires the Supabase identity backend', async () => {
    vi.stubEnv('ACADEMY_BACKEND', 'azure');
    vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND', 'azure');
    const { grantRole } = await import('../../scripts/grant-role');
    await expect(grantRole(centralGrant)).rejects.toThrow('Supabase identity backend');
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });
});
