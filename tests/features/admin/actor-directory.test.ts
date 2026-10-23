import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => { throw new Error('no env'); }) }));

import {
  ACTOR_BATCH_SIZE,
  actorDisplayNames,
  actorInitials,
  normalizeActorIds,
} from '@/features/admin/actor-directory';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

type Result = { data: unknown; error: unknown };

function profileClient(respond: (ids: string[]) => Result | Promise<Result>) {
  const calls: Array<{ table: string; columns: string; column: string; ids: string[] }> = [];
  const client = {
    from(table: 'profiles') {
      return {
        select(columns: string) {
          return {
            in(column: string, ids: string[]) {
              calls.push({ table, columns, column, ids });
              return Promise.resolve(respond(ids));
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

describe('actor directory', () => {
  it('reads display name, avatar and initials from profiles, with handle as the name fallback', async () => {
    const { client, calls } = profileClient(() => ({
      data: [
        { id: A, display_name: 'Nguyễn Minh Anh', handle: 'minhanh', avatar_url: 'https://cdn.example/a.png' },
        { id: B, display_name: '  ', handle: 'tran-binh', avatar_url: null },
      ],
      error: null,
    }));
    const actors = await actorDisplayNames([A, B], client);
    expect(calls).toEqual([{ table: 'profiles', columns: 'id, handle, display_name, avatar_url', column: 'id', ids: [A, B] }]);
    expect(actors.get(A)).toEqual({ name: 'Nguyễn Minh Anh', avatarUrl: 'https://cdn.example/a.png', initials: 'MA' });
    expect(actors.get(B)).toEqual({ name: 'tran-binh', avatarUrl: null, initials: 'TB' });
  });

  it('leaves out profiles without any usable name so callers show their own fallback', async () => {
    const { client } = profileClient(() => ({ data: [{ id: A, display_name: null, handle: null, avatar_url: null }], error: null }));
    const actors = await actorDisplayNames([A], client);
    expect(actors.has(A)).toBe(false);
  });

  it('dedupes ids, drops null and malformed ids and skips the query when nothing is left', async () => {
    expect(normalizeActorIds([A, A.toUpperCase(), null, undefined, '', 'system', ` ${B} `])).toEqual([A, B]);
    const { client, calls } = profileClient(() => ({ data: [], error: null }));
    const actors = await actorDisplayNames([null, 'not-a-uuid', undefined], client);
    expect(actors.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('batches at most 100 ids per query', async () => {
    const ids = Array.from({ length: 2 * ACTOR_BATCH_SIZE + 5 }, (_, index) => uuid(index + 1));
    const { client, calls } = profileClient((batch) => ({
      data: batch.map((id) => ({ id, display_name: `Người ${id.slice(-3)}`, avatar_url: null })),
      error: null,
    }));
    const actors = await actorDisplayNames(ids, client);
    expect(calls.map((call) => call.ids.length)).toEqual([100, 100, 5]);
    expect(actors.size).toBe(ids.length);
  });

  it('never throws: a failed or rejected batch leaves only its ids out', async () => {
    const { client } = profileClient((batch) => {
      if (batch.includes(A)) return { data: null, error: { message: 'boom' } };
      if (batch.includes(B)) throw new Error('network');
      return { data: [{ id: C, display_name: 'Lê Chi', avatar_url: null }], error: null };
    });
    const results = await Promise.all([
      actorDisplayNames([A], client),
      actorDisplayNames([B], client),
      actorDisplayNames([C], client),
    ]);
    expect(results.map((map) => map.size)).toEqual([0, 0, 1]);
    expect(results[2].get(C)?.name).toBe('Lê Chi');
  });

  it('returns an empty map when the service client cannot be created', async () => {
    await expect(actorDisplayNames([A])).resolves.toEqual(new Map());
  });

  it('builds initials from the last two words, keeping Vietnamese letters', () => {
    expect(actorInitials('Đặng Ánh')).toBe('ĐÁ');
    expect(actorInitials('an')).toBe('A');
    expect(actorInitials('')).toBe('');
  });
});
