import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn(), maybeSingle: vi.fn(), supabaseUser: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: mocks.supabaseUser }));

import { buildLearnerIdentity, learnerIdentity } from '@/features/workspace-ui/identity.server';

function profileRow(row: unknown, error: unknown = null) {
  mocks.maybeSingle.mockResolvedValue({ data: row, error });
  mocks.supabaseUser.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }) });
}

afterEach(() => { vi.clearAllMocks(); });

describe('learner identity', () => {
  it('falls back from display name to handle to the email local part', () => {
    expect(buildLearnerIdentity({ displayName: 'Nguyễn An', handle: 'an', email: 'an@example.com' })).toEqual({ name: 'Nguyễn An', initials: 'NA', handle: 'an' });
    expect(buildLearnerIdentity({ displayName: ' ', handle: 'an-nguyen', email: 'an@example.com' })).toEqual({ name: 'an-nguyen', initials: 'AN', handle: 'an-nguyen' });
    expect(buildLearnerIdentity({ email: 'minh.anh@example.com' })).toEqual({ name: 'minh.anh', initials: 'MA', handle: '' });
    expect(buildLearnerIdentity({})).toEqual({ name: '', initials: '', handle: '' });
  });

  it('reads the profile for the signed-in learner', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'learner-1', email: 'an@example.com' });
    profileRow({ display_name: 'Nguyễn An', handle: 'an-nguyen' });
    await expect(learnerIdentity()).resolves.toEqual({ name: 'Nguyễn An', initials: 'NA', handle: 'an-nguyen' });
  });

  it('never throws: a failed read falls back to the email', async () => {
    mocks.getSessionUser.mockResolvedValue({ id: 'learner-1', email: 'avery@example.com' });
    mocks.supabaseUser.mockRejectedValue(new Error('offline'));
    await expect(learnerIdentity()).resolves.toEqual({ name: 'avery', initials: 'A', handle: '' });
    profileRow(null, { message: 'denied' });
    await expect(learnerIdentity()).resolves.toEqual({ name: 'avery', initials: 'A', handle: '' });
    mocks.getSessionUser.mockRejectedValue(new Error('Unable to authenticate user'));
    await expect(learnerIdentity()).resolves.toEqual({ name: '', initials: '', handle: '' });
  });
});
