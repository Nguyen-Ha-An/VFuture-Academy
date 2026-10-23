import { describe, expect, it, vi } from 'vitest';

import {
  STAGING_AUTH_ACCOUNT_VARIABLES,
  createStagingAuthApi,
  readStagingAuthEnvironment,
  setupStagingAuth,
  type PreparedStagingAccount,
  type StagingAuthApi,
} from '../../scripts/setup-staging-auth';

const passwords = ['Aa1!fixture-password', 'Bb2!fixture-password', 'Cc3!fixture-password', 'Dd4!fixture-password', 'Ee5!fixture-password', 'Ff6!fixture-password', 'Gg7!fixture-password', 'Hh8!fixture-password', 'Ii9!fixture-password'];
const accounts: PreparedStagingAccount[] = passwords.map((password, index) => ({ email: `recovery-fixture-${index + 1}@vfuture.example`, password }));

function environment() {
  const source: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://stage-ref.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    SEED_DEV_PROJECT_REF: 'stage-ref',
  };
  STAGING_AUTH_ACCOUNT_VARIABLES.forEach(([emailName, passwordName], index) => {
    source[emailName] = accounts[index]!.email;
    source[passwordName] = accounts[index]!.password;
  });
  return source;
}

function api(users: Array<{ email: string; recoveryFixture: boolean }> = []): StagingAuthApi {
  return { listUsers: vi.fn(async () => users), createUser: vi.fn(async () => undefined) };
}

describe('staging Auth setup', () => {
  it('requires the exact hosted staging target and refuses a production override', () => {
    expect(() => readStagingAuthEnvironment(environment())).not.toThrow();
    expect(() => readStagingAuthEnvironment({ ...environment(), NEXT_PUBLIC_SUPABASE_URL: 'https://other-ref.supabase.co' })).toThrow('exact hosted');
    expect(() => readStagingAuthEnvironment({ ...environment(), SEED_ALLOW_PROD: '1' })).toThrow('Production override');
  });

  it('validates all nine distinct owned-domain emails and strong passwords before any API call', async () => {
    const staging = api();
    const invalid = accounts.map(account => ({ ...account }));
    invalid[8] = { email: 'person@example.com', password: 'weak' };
    await expect(setupStagingAuth(staging, invalid)).rejects.toThrow('fixture emails');
    expect(staging.listUsers).not.toHaveBeenCalled();
    expect(staging.createUser).not.toHaveBeenCalled();

    const duplicate = accounts.map(account => ({ ...account }));
    duplicate[8]!.email = duplicate[0]!.email.toUpperCase();
    await expect(setupStagingAuth(staging, duplicate)).rejects.toThrow('distinct');
    expect(staging.listUsers).not.toHaveBeenCalled();

    const weak = accounts.map(account => ({ ...account }));
    weak[8]!.password = 'too-short';
    await expect(setupStagingAuth(staging, weak)).rejects.toThrow('password must be strong');
    expect(staging.listUsers).not.toHaveBeenCalled();
  });

  it('creates all missing users as confirmed recovery fixtures', async () => {
    const staging = api();
    await expect(setupStagingAuth(staging, accounts)).resolves.toEqual({ created: 9, existing: 0 });
    expect(staging.createUser).toHaveBeenCalledTimes(9);
    expect(staging.createUser).toHaveBeenNthCalledWith(1, {
      ...accounts[0],
      emailConfirm: true,
      appMetadata: { recovery_fixture: true },
    });
  });

  it('reuses matching owned users without changing credentials or metadata', async () => {
    const staging = api(accounts.map(account => ({ email: account.email, recoveryFixture: true })));
    await expect(setupStagingAuth(staging, accounts)).resolves.toEqual({ created: 0, existing: 9 });
    expect(staging.createUser).not.toHaveBeenCalled();
  });

  it('rejects a non-owned email collision before creating any users', async () => {
    const staging = api([{ email: accounts[8]!.email, recoveryFixture: false }]);
    await expect(setupStagingAuth(staging, accounts)).rejects.toThrow('owned by another account');
    expect(staging.createUser).not.toHaveBeenCalled();
  });

  it('does not accept a user-editable metadata marker as fixture ownership', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ users: [{
        email: accounts[8]!.email,
        user_metadata: { recovery_fixture: true },
        app_metadata: {},
      }] }), { status: 200 });
    });
    const staging = createStagingAuthApi('https://stage-ref.supabase.co', 'service-key', request);

    await expect(setupStagingAuth(staging, accounts)).rejects.toThrow('owned by another account');
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('recognizes the admin-controlled app metadata marker for idempotent reuse', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ users: accounts.map(account => ({
        email: account.email,
        app_metadata: { recovery_fixture: true },
      })) }), { status: 200 });
    });
    const staging = createStagingAuthApi('https://stage-ref.supabase.co', 'service-key', request);

    await expect(setupStagingAuth(staging, accounts)).resolves.toEqual({ created: 0, existing: 9 });
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('sanitizes Auth API failures without exposing account or credential values', async () => {
    const staging = api();
    vi.mocked(staging.createUser).mockRejectedValueOnce(new Error(`${accounts[0]!.email}:${accounts[0]!.password}`));
    let caught: unknown;
    try { await setupStagingAuth(staging, accounts); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('Staging Auth account creation failed.');
    expect((caught as Error).message).not.toContain('recovery-fixture');
    expect(staging.createUser).toHaveBeenCalledTimes(1);
  });

  it('uses the admin API with confirmed fixture metadata and safe API errors', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ users: [] }), { status: 200 });
    });
    const staging = createStagingAuthApi('https://stage-ref.supabase.co', 'service-key', request);
    await staging.createUser({ ...accounts[0]!, emailConfirm: true, appMetadata: { recovery_fixture: true } });
    const [, init] = request.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      email: accounts[0]!.email,
      password: accounts[0]!.password,
      email_confirm: true,
      app_metadata: { recovery_fixture: true },
    });

    const failing = createStagingAuthApi('https://stage-ref.supabase.co', 'service-key', vi.fn(async () => new Response('secret response', { status: 401 })));
    await expect(failing.listUsers()).rejects.toThrow('Staging Auth API request failed.');
  });
});
