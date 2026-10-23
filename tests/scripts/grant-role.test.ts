import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createServiceClient: vi.fn() }));

vi.mock('../../src/lib/supabase/service-client', () => ({ createServiceClient: mocks.createServiceClient }));

describe('grant-role script', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('parses valid arguments and rejects unknown roles before client creation', async () => {
    const script = await import('../../scripts/grant-role') as typeof import('../../scripts/grant-role') & {
      parseGrantRoleArguments?: (args: string[]) => { email: string; role: string; branchId?: string };
    };
    expect(script.parseGrantRoleArguments).toBeTypeOf('function');
    if (!script.parseGrantRoleArguments) return;

    expect(script.parseGrantRoleArguments(['admin@example.com', 'admin', 'vinsmc'])).toEqual({ email: 'admin@example.com', role: 'admin', branchId: 'vinsmc' });
    expect(() => script.parseGrantRoleArguments?.(['admin@example.com', 'owner'])).toThrow('Usage: npm run grant-role');
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('uses the script-safe service client to grant a validated role', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const updateUserById = vi.fn().mockResolvedValue({ error: null });
    const service = {
      auth: { admin: { listUsers: vi.fn().mockResolvedValue({ data: { users: [{ id: 'user-1', email: 'admin@example.com' }] }, error: null }), updateUserById } },
      from: vi.fn(() => ({ upsert })),
    };
    mocks.createServiceClient.mockReturnValue(service);
    const { grantRoleByEmail } = await import('../../scripts/grant-role');

    await grantRoleByEmail('admin@example.com', 'admin');

    expect(mocks.createServiceClient).toHaveBeenCalledWith('https://example.supabase.co', 'service-key');
    expect(updateUserById).toHaveBeenCalledWith('user-1', { email_confirm: true });
    expect(service.from).toHaveBeenCalledWith('role_assignments');
    expect(service.from).not.toHaveBeenCalledWith('user_roles');
    expect(upsert).toHaveBeenCalledWith({ user_id: 'user-1', role_definition_id: 'central_admin', branch_id: null }, { onConflict: 'user_id,role_definition_id,branch_id' });
  });
});
