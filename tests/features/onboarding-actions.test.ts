import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  supabaseUser: vi.fn(),
  assertActiveAccount: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: mocks.supabaseUser }));
vi.mock('@/lib/account-access', () => ({ assertActiveAccount: mocks.assertActiveAccount }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return { ...actual, redirect: vi.fn(actual.redirect) };
});

import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { completeOnboarding } from '@/features/auth/onboarding-actions';
import { initialOnboardingState } from '@/features/auth/onboarding-state';

const userId = 'verified-user';
const saved = { id: userId, handle: 'learner_1', display_name: 'Learner One' };
const pending = { ...saved, handle: null };
const next = '/app/courses/intro?mode=review#lesson';

function form(values: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ handle: saved.handle, displayName: saved.display_name, next, ...values })) {
    data.set(key, value);
  }
  return data;
}

function client() {
  const readResult = vi.fn().mockResolvedValue({ data: pending, error: null });
  const readEq = vi.fn(() => ({ maybeSingle: readResult }));
  const select = vi.fn(() => ({ eq: readEq }));
  const updateResult = vi.fn().mockResolvedValue({ data: saved, error: null });
  const updateSelect = vi.fn(() => ({ maybeSingle: updateResult }));
  const updateIs = vi.fn(() => ({ select: updateSelect }));
  const updateEq = vi.fn(() => ({ is: updateIs }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null });
  const from = vi.fn(() => ({ select, update }));
  return { auth: { getUser }, from, select, readEq, readResult, update, updateEq, updateIs, updateSelect, updateResult };
}

describe('completeOnboarding server action', () => {
  let db: ReturnType<typeof client>;

  afterEach(() => vi.unstubAllEnvs());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertActiveAccount.mockResolvedValue(undefined);
    db = client();
    mocks.supabaseUser.mockResolvedValue(db);
  });

  it('exports empty serializable form state', () => {
    expect(initialOnboardingState).toEqual({ values: { handle: '', displayName: '' }, fieldErrors: {}, error: null });
  });

  it('uses verified identity, ignores forged fields, trims values, then invalidates and redirects', async () => {
    await expect(completeOnboarding(initialOnboardingState, form({
      handle: ' learner_1 ', displayName: ' Learner One ', id: 'victim', userId: 'victim', role: 'admin',
    }))).rejects.toMatchObject({ digest: `NEXT_REDIRECT;replace;${next};307;` });

    expect(db.auth.getUser).toHaveBeenCalledOnce();
    expect(mocks.assertActiveAccount).toHaveBeenCalledWith(userId);
    expect(db.readEq).toHaveBeenCalledWith('id', userId);
    expect(db.updateEq).toHaveBeenCalledWith('id', userId);
    expect(db.updateIs).toHaveBeenCalledWith('handle', null);
    expect(db.update).toHaveBeenCalledExactlyOnceWith({ handle: saved.handle, display_name: saved.display_name });
    expect(db.updateSelect).toHaveBeenCalledWith('id, handle, display_name');
    expect(db.auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(db.update.mock.invocationCallOrder[0]);
    expect(mocks.assertActiveAccount.mock.invocationCallOrder[0]).toBeLessThan(db.update.mock.invocationCallOrder[0]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/welcome');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/app/courses/intro');
    expect(mocks.revalidatePath.mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(redirect).mock.invocationCallOrder[0]);
  });

  it.each([
    ['ab', 'Valid', { handle: 'invalidHandle' }],
    ['UpperCase', 'Valid', { handle: 'invalidHandle' }],
    ['a'.repeat(33), 'Valid', { handle: 'invalidHandle' }],
    ['good', ' ', { displayName: 'invalidDisplayName' }],
    ['good', 'a'.repeat(121), { displayName: 'invalidDisplayName' }],
    ['!', '', { handle: 'invalidHandle', displayName: 'invalidDisplayName' }],
  ])('validates handle %s and display name without writing', async (handle, displayName, fieldErrors) => {
    expect(await completeOnboarding(initialOnboardingState, form({ handle, displayName }))).toEqual({
      values: { handle, displayName }, fieldErrors, error: null,
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('keeps submitted values on duplicate handle', async () => {
    db.updateResult.mockResolvedValue({ data: null, error: { code: '23505', message: 'private database detail' } });
    expect(await completeOnboarding(initialOnboardingState, form({ handle: ' learner_1 ' }))).toEqual({
      values: { handle: ' learner_1 ', displayName: saved.display_name }, fieldErrors: { handle: 'handleTaken' }, error: null,
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: null },
    { data: pending, error: { message: 'RLS failure' } },
    { data: { ...pending, id: 'other' }, error: null },
  ])('returns a retryable load error for unavailable or wrong profile %#', async (response) => {
    db.readResult.mockResolvedValue(response);
    expect(await completeOnboarding(initialOnboardingState, form())).toMatchObject({ error: 'profileLoadError' });
    expect(db.update).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('handles a thrown profile read failure', async () => {
    db.readResult.mockRejectedValue(new Error('network failure'));
    expect(await completeOnboarding(initialOnboardingState, form())).toMatchObject({ error: 'profileLoadError' });
    expect(db.update).not.toHaveBeenCalled();
  });

  it('does not overwrite a completed profile even when submitted fields are invalid', async () => {
    db.readResult.mockResolvedValue({ data: saved, error: null });
    await expect(completeOnboarding(initialOnboardingState, form({ handle: '!' }))).rejects.toThrow('NEXT_REDIRECT');
    expect(db.update).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(next);
  });

  it.each([
    { data: null, error: { code: '42501' } },
    { data: null, error: null },
    { data: { ...saved, id: 'other' }, error: null },
    { data: { ...saved, handle: 'different' }, error: null },
    { data: { ...saved, display_name: 'Different' }, error: null },
  ])('does not navigate for failed, missing, or mismatched updated rows %#', async (response) => {
    db.updateResult.mockResolvedValue(response);
    expect(await completeOnboarding(initialOnboardingState, form())).toEqual({
      values: { handle: saved.handle, displayName: saved.display_name }, fieldErrors: {}, error: 'profileUpdateError',
    });
    expect(redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('handles a thrown update failure without navigating', async () => {
    db.updateResult.mockRejectedValue(new Error('network failure'));
    expect(await completeOnboarding(initialOnboardingState, form())).toMatchObject({ error: 'profileUpdateError' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it('rereads a concurrent completion and redirects without a second write', async () => {
    db.updateResult.mockResolvedValue({ data: null, error: null });
    db.readResult.mockResolvedValueOnce({ data: pending, error: null })
      .mockResolvedValueOnce({ data: { ...saved, handle: 'winner', display_name: 'Other tab' }, error: null });
    await expect(completeOnboarding(initialOnboardingState, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(db.readResult).toHaveBeenCalledTimes(2);
    expect(db.update).toHaveBeenCalledOnce();
    expect(db.updateIs).toHaveBeenCalledWith('handle', null);
    expect(redirect).toHaveBeenCalledWith(next);
  });

  it.each([
    { data: null, error: null },
    { data: null, error: { message: 'read denied' } },
    { data: { ...saved, id: 'other' }, error: null },
  ])('does not navigate if concurrent completion cannot be confirmed %#', async (response) => {
    db.updateResult.mockResolvedValue({ data: null, error: null });
    db.readResult.mockResolvedValueOnce({ data: pending, error: null }).mockResolvedValueOnce(response);
    expect(await completeOnboarding(initialOnboardingState, form())).toMatchObject({ error: 'profileUpdateError' });
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each(['returned', 'thrown'])('preserves input on a %s operational getUser error without profile I/O', async (kind) => {
    const error = new Error('Auth service temporarily unavailable');
    if (kind === 'returned') db.auth.getUser.mockResolvedValue({ data: { user: null }, error });
    else db.auth.getUser.mockRejectedValue(error);
    const values = { handle: ' learner_1 ', displayName: ' Learner One ' };

    await expect(completeOnboarding(initialOnboardingState, form(values))).resolves.toEqual({
      values, fieldErrors: {}, error: 'profileLoadError',
    });
    expect(db.auth.getUser).toHaveBeenCalledOnce();
    expect(mocks.assertActiveAccount).not.toHaveBeenCalled();
    expect(mocks.supabaseUser).toHaveBeenCalledOnce();
    expect(db.from).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('preserves input on an ordinary account lookup error without profile I/O', async () => {
    mocks.assertActiveAccount.mockRejectedValue(new Error('Unable to verify account status'));
    const values = { handle: ' learner_1 ', displayName: ' Learner One ' };

    await expect(completeOnboarding(initialOnboardingState, form(values))).resolves.toEqual({
      values, fieldErrors: {}, error: 'profileLoadError',
    });
    expect(db.auth.getUser).toHaveBeenCalledOnce();
    expect(mocks.assertActiveAccount).toHaveBeenCalledWith(userId);
    expect(mocks.supabaseUser).toHaveBeenCalledOnce();
    expect(db.from).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('preserves next through expired-session login redirect and never reads or writes profiles', async () => {
    db.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(completeOnboarding(initialOnboardingState, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(next)}`);
    expect(db.from).not.toHaveBeenCalled();
    expect(mocks.assertActiveAccount).not.toHaveBeenCalled();
  });

  it('propagates forbidden account access without any profile write', async () => {
    vi.stubEnv('__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS', 'true');
    mocks.assertActiveAccount.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Inactive account'));
    await expect(completeOnboarding(initialOnboardingState, form())).rejects.toMatchObject({
      digest: 'NEXT_HTTP_ERROR_FALLBACK;403',
    });
    expect(db.from).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example', '//evil.example', '/login', '/app\\evil', ''])('falls back to /app for unsafe next %s', async (unsafe) => {
    await expect(completeOnboarding(initialOnboardingState, form({ next: unsafe }))).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/app');
  });

  it('does not swallow Next redirect exceptions thrown during a profile read', async () => {
    const signal = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' });
    db.readResult.mockRejectedValue(signal);
    await expect(completeOnboarding(initialOnboardingState, form())).rejects.toBe(signal);
    expect(db.update).not.toHaveBeenCalled();
  });
});
