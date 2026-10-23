import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email?: string },
  userError: null as Error | null,
  profile: { data: null as unknown, error: null as unknown },
  profileThrows: false,
  cookies: new Map<string, string>(),
  selects: [] as string[],
  eqs: [] as Array<[string, string]>,
}));

vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(async () => {
    if (state.userError) throw state.userError;
    return state.user;
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  supabaseUser: vi.fn(async () => ({
    from: (table: string) => {
      expect(table).toBe('profiles');
      return {
        select: (columns: string) => {
          state.selects.push(columns);
          return {
            eq: (column: string, value: string) => {
              state.eqs.push([column, value]);
              return {
                maybeSingle: async () => {
                  if (state.profileThrows) throw new Error('network down');
                  return state.profile;
                },
              };
            },
          };
        },
      };
    },
  })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name)! } : undefined) })),
}));

import { buildStaffIdentity, staffIdentity, staffInitials } from '@/features/staff-ui/identity.server';
import { parseSidebarOpen, readStaffChrome } from '@/features/staff-ui/chrome.server';

afterEach(() => {
  state.user = null;
  state.userError = null;
  state.profile = { data: null, error: null };
  state.profileThrows = false;
  state.cookies.clear();
  state.selects = [];
  state.eqs = [];
});

describe('staffInitials', () => {
  it('takes the first letters of the last two words of a Vietnamese name, keeping diacritics', () => {
    expect(staffInitials('Nguyễn Minh Anh')).toBe('MA');
    expect(staffInitials('Lê Thị Ánh Tuyết')).toBe('ÁT');
    expect(staffInitials('  trần   đức  ')).toBe('TĐ');
    // Decomposed input (NFD) still yields one composed letter.
    expect(staffInitials('Phạm Ẩn'.normalize('NFD'))).toBe('PẨ');
  });

  it('uses one letter for a single-word name and falls back to the email local part', () => {
    expect(staffInitials('An')).toBe('A');
    expect(staffInitials('', 'minh.anh@vfuture.edu.vn')).toBe('MA');
    expect(staffInitials(null, 'teacher@vfuture.edu.vn')).toBe('T');
    expect(staffInitials(null, null)).toBe('');
  });
});

describe('buildStaffIdentity', () => {
  it('prefers the display name and falls back to the email local part, then to empty for the UI to localize', () => {
    expect(buildStaffIdentity({ displayName: 'Nguyễn Minh Anh', email: 'anh@x.vn', avatarUrl: '/api/v1/media/a' }))
      .toEqual({ name: 'Nguyễn Minh Anh', email: 'anh@x.vn', avatarUrl: '/api/v1/media/a', initials: 'MA' });
    expect(buildStaffIdentity({ displayName: '   ', email: 'minh.anh@x.vn' }))
      .toEqual({ name: 'minh.anh', email: 'minh.anh@x.vn', avatarUrl: null, initials: 'MA' });
    expect(buildStaffIdentity({})).toEqual({ name: '', email: null, avatarUrl: null, initials: '' });
  });
});

describe('staffIdentity', () => {
  it('reads display_name and avatar_url from the signed-in profile', async () => {
    state.user = { id: 'u1', email: 'anh@vfuture.edu.vn' };
    state.profile = { data: { display_name: 'Nguyễn Minh Anh', avatar_url: '/api/v1/media/abc' }, error: null };
    await expect(staffIdentity()).resolves.toEqual({ name: 'Nguyễn Minh Anh', email: 'anh@vfuture.edu.vn', avatarUrl: '/api/v1/media/abc', initials: 'MA' });
    expect(state.selects).toEqual(['display_name,avatar_url']);
    expect(state.eqs).toEqual([['id', 'u1']]);
  });

  it('falls back to the email when there is no profile row, no name, or the read fails', async () => {
    state.user = { id: 'u1', email: 'minh.anh@vfuture.edu.vn' };
    const fallback = { name: 'minh.anh', email: 'minh.anh@vfuture.edu.vn', avatarUrl: null, initials: 'MA' };

    state.profile = { data: null, error: null };
    await expect(staffIdentity()).resolves.toEqual(fallback);

    state.profile = { data: { display_name: null, avatar_url: null }, error: null };
    await expect(staffIdentity()).resolves.toEqual(fallback);

    state.profile = { data: null, error: { message: 'permission denied' } };
    await expect(staffIdentity()).resolves.toEqual(fallback);

    state.profileThrows = true;
    await expect(staffIdentity()).resolves.toEqual(fallback);
  });

  it('never throws when the session cannot be read or is missing', async () => {
    state.userError = new Error('Unable to authenticate user');
    await expect(staffIdentity()).resolves.toEqual({ name: '', email: null, avatarUrl: null, initials: '' });
    state.userError = null;
    state.user = null;
    await expect(staffIdentity()).resolves.toEqual({ name: '', email: null, avatarUrl: null, initials: '' });
  });
});

describe('readStaffChrome', () => {
  it('defaults to the system theme and an open sidebar without cookies', async () => {
    state.user = { id: 'u1', email: 'anh@vfuture.edu.vn' };
    const chrome = await readStaffChrome();
    expect(chrome.theme).toBe('system');
    expect(chrome.sidebarOpen).toBe(true);
    expect(chrome.identity.email).toBe('anh@vfuture.edu.vn');
  });

  it('reads vf-theme and collapses only for sidebar_state=false', async () => {
    state.cookies.set('vf-theme', 'dark');
    state.cookies.set('sidebar_state', 'false');
    await expect(readStaffChrome()).resolves.toMatchObject({ theme: 'dark', sidebarOpen: false });
    state.cookies.set('vf-theme', 'neon');
    state.cookies.set('sidebar_state', 'true');
    await expect(readStaffChrome()).resolves.toMatchObject({ theme: 'system', sidebarOpen: true });
    expect(parseSidebarOpen(undefined)).toBe(true);
    expect(parseSidebarOpen('garbage')).toBe(true);
    expect(parseSidebarOpen('false')).toBe(false);
  });
});
