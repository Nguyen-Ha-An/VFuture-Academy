// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ requireApiUser: vi.fn(), supabaseUser: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: mocks.supabaseUser }));

import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { ApiError } from '@/lib/api';

describe('profile locale route and switcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ id: 'user-1' });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.cookie = 'locale=; max-age=0; path=/';
  });

  it('validates locale and updates only the authenticated profile with the user-bound client', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'user-1' }, error: null });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    mocks.supabaseUser.mockResolvedValue({ from: vi.fn(() => ({ update })) });
    const { PATCH } = await import('@/app/api/v1/profile/locale/route');

    const response = await PATCH(new Request('https://academy.example/api/v1/profile/locale', { method: 'PATCH', body: JSON.stringify({ locale: 'en' }) }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { locale: 'en' } });
    expect(update).toHaveBeenCalledWith({ locale: 'en' });
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('rejects unsupported locales before updating a profile', async () => {
    const from = vi.fn();
    mocks.supabaseUser.mockResolvedValue({ from });
    const { PATCH } = await import('@/app/api/v1/profile/locale/route');

    const response = await PATCH(new Request('https://academy.example/api/v1/profile/locale', { method: 'PATCH', body: JSON.stringify({ locale: 'fr' }) }));

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns 401 for an unauthenticated API caller without logging an internal error', async () => {
    mocks.requireApiUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { PATCH } = await import('@/app/api/v1/profile/locale/route');

    const response = await PATCH(new Request('https://academy.example/api/v1/profile/locale', {
      method: 'PATCH', body: JSON.stringify({ locale: 'en' }),
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ['RLS denial', { code: '42501' }, 403, 'FORBIDDEN'],
    ['missing profile', null, 404, 'PROFILE_NOT_FOUND'],
    ['database failure', { code: '08006' }, 500, 'DATABASE_ERROR'],
  ])('maps %s to an explicit API error', async (_label, error, status, code) => {
    const single = vi.fn().mockResolvedValue({ data: null, error });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    mocks.supabaseUser.mockResolvedValue({ from: vi.fn(() => ({ update })) });
    const { PATCH } = await import('@/app/api/v1/profile/locale/route');

    const response = await PATCH(new Request('https://academy.example/api/v1/profile/locale', {
      method: 'PATCH', body: JSON.stringify({ locale: 'en' }),
    }));

    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it('surfaces a failed profile update instead of reloading blindly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    render(<NextIntlClientProvider locale="en" messages={en}><LocaleSwitcher /></NextIntlClientProvider>);

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'vi' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not save your language preference.');
    expect(document.cookie).not.toContain('locale=vi');
  });

  it('marks locale cookies Secure for HTTPS responses', async () => {
    const localeModule = await import('@/components/LocaleSwitcher') as typeof import('@/components/LocaleSwitcher') & {
      localeCookie?: (locale: 'vi' | 'en', secure: boolean) => string;
    };
    expect(localeModule.localeCookie).toBeTypeOf('function');
    if (!localeModule.localeCookie) return;
    expect(localeModule.localeCookie('en', true)).toContain('; secure');
    expect(localeModule.localeCookie('en', false)).not.toContain('; secure');
  });
});
