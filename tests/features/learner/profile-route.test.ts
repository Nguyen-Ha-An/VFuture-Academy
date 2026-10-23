import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireApiUser: vi.fn(), supabaseUser: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: mocks.supabaseUser }));

describe('learner profile route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ id: 'user-1' });
  });

  it('rejects a non-boolean public-profile value before opening a database query', async () => {
    const from = vi.fn();
    mocks.supabaseUser.mockResolvedValue({ from });
    const { PATCH } = await import('@/app/api/v1/profile/route');

    const response = await PATCH(new Request('https://academy.example/api/v1/profile', {
      method: 'PATCH',
      body: JSON.stringify({ profilePublic: 'yes' }),
    }));

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('updates only the authenticated learner public-profile flag', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'user-1', profile_public: true }, error: null });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    mocks.supabaseUser.mockResolvedValue({ from: vi.fn(() => ({ update })) });
    const { PATCH } = await import('@/app/api/v1/profile/route');

    const response = await PATCH(new Request('https://academy.example/api/v1/profile', {
      method: 'PATCH',
      body: JSON.stringify({ profilePublic: true }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { profilePublic: true } });
    expect(update).toHaveBeenCalledWith({ profile_public: true });
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('composes learner rewards and skills settings without a duplicate visibility mutation path', () => {
    const read = (...parts: string[]) => readFileSync(join(process.cwd(), 'src', ...parts), 'utf8');
    const page = read('app', 'app', 'profile', 'page.tsx');
    const view = read('features', 'workspace-ui', 'profile', 'ProfileBenchView.tsx');
    const certificate = read('features', 'workspace-ui', 'profile', 'CalibrationCertificate.tsx');
    const learnerSettings = read('features', 'learner', 'ui', 'ProfileSettings.tsx');

    expect(page).toContain('skills={evidence.skills}');
    expect(page).toContain('settings={settings}');
    expect(view).toContain('<ProfileSettings initial={settings} />');
    expect(certificate).toContain('/api/v1/me/certificates/${encodeURIComponent(certificate.id)}/download');
    expect(learnerSettings).not.toContain("fetch('/api/v1/profile'");
  });
});
