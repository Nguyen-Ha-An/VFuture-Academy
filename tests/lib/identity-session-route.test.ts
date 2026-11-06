import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), report: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.user }));
vi.mock('@/lib/observability', () => ({ reportError: mocks.report }));
import { ApiError } from '@/lib/api';
import { GET } from '@/app/api/v1/auth/session/route';

describe('authoritative browser session checks', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.report.mockReturnValue('test-correlation'); });
  it('returns only the authenticated actor and disables caches', async () => {
    mocks.user.mockResolvedValue({ id: 'original-actor', email: 'private@example.test', user_metadata: { private: true } });
    const response = await GET(new Request('https://academy.example/api/v1/auth/session'));
    expect(await response.json()).toEqual({ userId: 'original-actor' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it.each([401, 403, 500])('preserves the status %s and never clears a session cookie', async status => {
    mocks.user.mockRejectedValue(status === 500 ? new Error('database unavailable') : new ApiError(status, 'ACCESS', 'Access unavailable'));
    const response = await GET(new Request('https://academy.example/api/v1/auth/session'));
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).not.toContain('database unavailable');
  });
});
