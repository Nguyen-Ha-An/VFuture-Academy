import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ revision: 1, status: 'draft', race: false, filters: [] as [string, unknown][], deleted: false }));
vi.mock('server-only', () => ({}));
vi.mock('@/features/teaching/assignments', () => ({ assertCourseTeaching: async () => {}, teachingCourseScope: async () => ({all: true, branchIds: [], assignments: []}) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: () => ({
  from: () => {
    let updating = false;
    const filters: [string, unknown][] = [];
    const query = {
      select: () => query,
      update: () => { updating = true; return query; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      maybeSingle: async () => {
        if (!updating) return { data: { id: 'id', branch_id: 'school', status: state.status, revision: state.revision }, error: null };
        state.filters = filters;
        if (state.race) state.revision += 1;
        if (filters.some(([key, value]) => key === 'revision' && value !== state.revision)) return { data: null, error: null };
        state.revision += 1; state.status = 'archived';
        return { data: { id: 'id', branch_id: 'school', status: state.status, revision: state.revision }, error: null };
      },
    };
    return query;
  },
  rpc: async (_name: string, args: { p_expected_revision: number }) => {
    if (state.race) state.revision += 1;
    state.deleted = args.p_expected_revision === state.revision && state.status === 'draft';
    return { data: state.deleted, error: null };
  },
}) }));
import { changeAnnouncement } from '@/features/teaching/service';
import type { Actor } from '@/lib/permissions';
const actor = { userId: 'teacher', roles: [] } as Actor;

describe('announcement revision concurrency', () => {
  beforeEach(() => { state.revision = 1; state.status = 'draft'; state.race = false; state.filters = []; state.deleted = false; });
  it('rejects a stale revision before mutation', async () => {
    await expect(changeAnnouncement(actor, 'id', 'school', 'archive', 2)).rejects.toMatchObject({ status: 409, code: 'STALE_ANNOUNCEMENT' });
    expect(state.filters).toEqual([]);
  });
  it('applies the revision to the update statement and rejects a concurrent edit', async () => {
    state.race = true;
    await expect(changeAnnouncement(actor, 'id', 'school', 'archive', 1)).rejects.toMatchObject({ status: 409, code: 'STALE_ANNOUNCEMENT' });
    expect(state.filters).toContainEqual(['revision', 1]);
    expect(state.status).toBe('draft');
  });
  it('requires the same revision when deleting a draft', async () => {
    state.race = true;
    await expect(changeAnnouncement(actor, 'id', 'school', 'delete', 1)).rejects.toMatchObject({ status: 409, code: 'STALE_ANNOUNCEMENT' });
    expect(state.deleted).toBe(false);
  });
  it('returns the database-confirmed next revision after an update', async () => {
    const result = await changeAnnouncement(actor, 'id', 'school', 'archive', 1);
    expect(result).toMatchObject({ announcement: { revision: 2, status: 'archived' } });
  });
});
