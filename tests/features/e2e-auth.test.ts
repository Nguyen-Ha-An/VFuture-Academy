import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { roleStorageStatePath, unavailableRoleStorageStateMessage } from '../e2e/support/auth';

afterEach(() => vi.unstubAllEnvs());

describe('Playwright role storage paths', () => {
  it('fails explicitly required staging role states even outside CI', () => {
    vi.stubEnv('CI', '');
    vi.stubEnv('E2E_REQUIRE_ROLE_STATES', '1');
    vi.stubEnv('PLAYWRIGHT_ADMIN_STORAGE_STATE', '/tmp/vfuture-intentionally-missing-role-state.json');
    expect(() => unavailableRoleStorageStateMessage(['admin'])).toThrow('Missing Playwright storage state');
  });
  it('keeps default role state under the ignored authentication directory', () => {
    vi.stubEnv('PLAYWRIGHT_ADMIN_STORAGE_STATE', '');

    expect(roleStorageStatePath('admin')).toBe(resolve(process.cwd(), 'playwright/.auth/admin.json'));
  });

  it('rejects configured storage state inside the repository outside playwright/.auth', () => {
    vi.stubEnv('PLAYWRIGHT_ADMIN_STORAGE_STATE', 'tests/fixtures/admin-storage.json');

    expect(() => roleStorageStatePath('admin')).toThrow(
      'Playwright storage state inside the repository must be under playwright/.auth.',
    );
  });
});
