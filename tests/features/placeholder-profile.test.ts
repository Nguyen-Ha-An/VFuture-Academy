import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
import { repairPlaceholderProfile } from '@/features/auth/placeholder-profile';

const before = { handle: 'STU-unknown', display_name: 'unknown' };
function database(options: { history?: unknown[]; historyError?: unknown; collision?: boolean; concurrent?: boolean; storedHandle?: string } = {}) {
  const filters: Record<string, unknown> = {};
  let mutation: Record<string, string> = {};
  const update = vi.fn((values: Record<string, string>) => { mutation = values; return query; });
  const query = {
    update,
    eq: vi.fn((key: string, value: unknown) => { filters[key] = value; return query; }),
    select: vi.fn(() => query),
    maybeSingle: vi.fn(async () => options.collision ? { data: null, error: { code: '23505' } }
      : options.concurrent ? { data: null, error: null }
      : { data: { id: 'user', handle: options.storedHandle ?? before.handle, ...mutation }, error: null }),
  };
  const history = {
    select: vi.fn(() => history), eq: vi.fn(() => history),
    limit: vi.fn(async () => ({ data: options.history ?? [], error: options.historyError ?? null })),
  };
  const from = vi.fn((table: string) => table === 'profile_handle_changes' ? history : query);
  return { client: { from } as never, from, filters, query, update, mutation: () => mutation };
}

describe('untouched CIAM placeholder repair', () => {
  it('changes the explicit name and generated handle in one conditional service mutation', async () => {
    const db = database();
    await expect(repairPlaceholderProfile('user', before, 'Đặng Thị Ánh', db.client)).resolves.toBe(true);
    expect(db.filters).toEqual({ id: 'user', handle: 'STU-unknown', display_name: 'unknown' });
    expect(db.mutation()).toEqual({ display_name: 'Đặng Thị Ánh', handle: expect.stringMatching(/^STU-dang-thi-anh-[a-f0-9]{6}$/) });
    expect(db.from.mock.calls.map(([table]) => table)).toEqual(['profile_handle_changes', 'profiles']);
    expect(db.update).toHaveBeenCalledOnce();
  });
  it.each([
    { handle: 'STU-unknown', display_name: 'Edited Name' },
    { handle: 'STU-unknown', display_name: '' },
  ])('preserves edited or already non-placeholder profiles %#', async current => {
    const db = database();
    expect(await repairPlaceholderProfile('user', current, 'Real Name', db.client)).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });
  it('repairs only the missing name while preserving an edited handle', async () => {
    const db = database({ storedHandle: 'STU-edited_name' });
    expect(await repairPlaceholderProfile('user', { ...before, handle: 'STU-edited_name' }, 'Real Name', db.client)).toBe(true);
    expect(db.mutation()).toEqual({ display_name: 'Real Name' });
    expect(db.filters).toEqual({ id: 'user', display_name: 'unknown' });
    expect(db.from.mock.calls.map(([table]) => table)).toEqual(['profiles']);
  });
  it('keeps a placeholder-looking handle when manual history exists but repairs the missing name', async () => {
    const db = database({ history: [{ id: 'manual-change' }] });
    expect(await repairPlaceholderProfile('user', before, 'Real Name', db.client)).toBe(true);
    expect(db.mutation()).toEqual({ display_name: 'Real Name' });
    expect(db.filters).toEqual({ id: 'user', display_name: 'unknown' });
  });
  it('preserves a concurrently edited record when the conditional mutation matches no row', async () => {
    const db = database({ concurrent: true });
    expect(await repairPlaceholderProfile('user', before, 'Real Name', db.client)).toBe(false);
    expect(db.update).toHaveBeenCalledOnce();
  });
  it('leaves a collision retryable after one atomic mutation attempt', async () => {
    const db = database({ collision: true });
    await expect(repairPlaceholderProfile('user', before, 'Real Name', db.client)).rejects.toMatchObject({ code: 'PROFILE_UNAVAILABLE' });
    expect(db.update).toHaveBeenCalledOnce();
  });
  it('fails closed when change history cannot be read or the new name is another placeholder', async () => {
    const db = database({ historyError: { code: '42501' } });
    await expect(repairPlaceholderProfile('user', before, 'Real Name', db.client)).rejects.toMatchObject({ code: 'PROFILE_UNAVAILABLE' });
    expect(db.update).not.toHaveBeenCalled();
    await expect(repairPlaceholderProfile('user', before, ' UNKNOWN ', db.client)).rejects.toMatchObject({ code: 'INVALID_NAME' });
  });
});
