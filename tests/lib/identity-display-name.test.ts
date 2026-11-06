import { beforeEach, describe, expect, it, vi } from 'vitest';
import { identityDisplayName } from '@/lib/identity/display-name';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/database/azure-client', () => ({ createAzureDataClient: () => ({ rpc }) }));
import { initializeIdentityProfile, resolveIdentityUser } from '@/lib/identity/store';

describe('verified provider display names', () => {
  beforeEach(() => {
    rpc.mockReset().mockReturnValue({ abortSignal: vi.fn().mockResolvedValue({
      data: { id: 'user', created_at: '', raw_user_meta_data: {} }, error: null,
    }) });
  });
  it('prefers trimmed name, otherwise joins available given and family names', () => {
    expect(identityDisplayName({ name: ' Full Name ', given_name: 'Other' })).toBe('Full Name');
    expect(identityDisplayName({ name: ' ', given_name: ' Đặng ', family_name: ' Thị Ánh ' })).toBe('Đặng Thị Ánh');
    expect(identityDisplayName({ given_name: ' An ' })).toBe('An');
    expect(identityDisplayName({ family_name: ' Nguyễn ' })).toBe('Nguyễn');
    expect(identityDisplayName({ name: ' UNKNOWN ', given_name: ' Đặng ', family_name: ' Ánh ' })).toBe('Đặng Ánh');
    expect(identityDisplayName({ name: 'unknown', email: 'person@example.test' })).toBe('');
  });
  it('bounds provider names and never falls back to an email or username', () => {
    expect(identityDisplayName({ name: 'x'.repeat(200) })).toHaveLength(160);
    expect(identityDisplayName({ given_name: 123, family_name: {}, email: 'person@example.test', preferred_username: 'private-user' })).toBe('');
  });
  it('uses the same verified fallback for identity creation and profile initialization', async () => {
    const claims = { iss: 'issuer', oid: 'subject', sub: 'pairwise', exp: 10, iat: 1,
      given_name: ' Đặng ', family_name: ' Thị Ánh ' };
    await resolveIdentityUser(claims);
    await initializeIdentityProfile('user', claims);
    await initializeIdentityProfile('user', claims, true);
    expect(rpc.mock.calls.map(([name, args]) => [name, args.p_display_name])).toEqual([
      ['academy_identity_resolve_user', 'Đặng Thị Ánh'],
      ['profile_initialize', 'Đặng Thị Ánh'],
      ['academy_identity_initialize_staff_profile', 'Đặng Thị Ánh'],
    ]);
  });
});
