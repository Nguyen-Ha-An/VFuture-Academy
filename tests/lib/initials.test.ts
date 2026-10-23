import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ getSessionUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseUser: vi.fn() }));

import { initials } from '@/lib/initials';
import { staffInitials } from '@/features/staff-ui/identity.server';

describe('initials', () => {
  it('uses the last two words of a Vietnamese name, keeping diacritics', () => {
    expect(initials('Nguyễn An')).toBe('NA');
    expect(initials('Nguyễn Minh Anh')).toBe('MA');
    expect(initials('lê thị ánh tuyết')).toBe('ÁT');
    expect(initials('Avery')).toBe('A');
  });

  it('falls back to the email local part and to empty', () => {
    expect(initials('', 'minh.anh@example.com')).toBe('MA');
    expect(initials(null)).toBe('');
  });

  it('is the helper the staff menu re-exports', () => {
    expect(staffInitials).toBe(initials);
  });
});
