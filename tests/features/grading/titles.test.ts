import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn(() => { throw new Error('no env'); }) }));

import {
  VERSION_TITLE_BATCH_SIZE,
  localizeOutlineTitle,
  resolveCourseTitle,
  resolveItemTitle,
  versionTitles,
} from '@/features/grading/titles';

const V1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const V2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type Result = { data: unknown; error: unknown };

function outlineClient(respond: (ids: string[]) => Result) {
  const calls: Array<{ table: string; columns: string; column: string; ids: string[] }> = [];
  const client = {
    from(table: 'course_version_outline') {
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

const row = {
  version_id: V1,
  course_id: 'python-co-ban',
  meta: { title: { vi: 'Python cơ bản', en: 'Python basics' } },
  outline: {
    modules: [
      { id: 'm1', title: 'Mở đầu', items: [
        { id: 'bai-1', type: 'lesson', title: { vi: 'Biến và kiểu dữ liệu', en: 'Variables and types' } },
        { id: 'du-an', type: 'assignment', title: 'Dự án cuối khoá' },
      ] },
      { id: 'm2', items: [{ id: 'chi-en', type: 'exam', title: { en: 'Final exam' } }, { id: 'no-title', type: 'lesson' }] },
    ],
  },
};

describe('version titles', () => {
  it('reads course and item titles from course_version_outline', async () => {
    const { client, calls } = outlineClient(() => ({ data: [row], error: null }));
    const titles = await versionTitles([V1, V1.toUpperCase(), null, 'bad-id'], client);
    expect(calls).toEqual([{ table: 'course_version_outline', columns: 'version_id,course_id,meta,outline', column: 'version_id', ids: [V1] }]);
    const version = titles.get(V1);
    expect(version?.courseId).toBe('python-co-ban');
    expect(version?.courseTitle).toEqual({ vi: 'Python cơ bản', en: 'Python basics' });
    expect([...version!.items.keys()]).toEqual(['bai-1', 'du-an', 'chi-en']);
    expect(version?.items.get('du-an')).toBe('Dự án cuối khoá');
  });

  it('resolves titles per locale with the other locale, then the id, as fallback', async () => {
    const { client } = outlineClient(() => ({ data: [row], error: null }));
    const titles = await versionTitles([V1], client);
    expect(resolveItemTitle(titles, V1, 'bai-1', 'en')).toBe('Variables and types');
    expect(resolveItemTitle(titles, V1, 'bai-1', 'vi')).toBe('Biến và kiểu dữ liệu');
    expect(resolveItemTitle(titles, V1, 'chi-en', 'vi')).toBe('Final exam');
    expect(resolveItemTitle(titles, V1, 'no-title', 'vi')).toBe('no-title');
    expect(resolveItemTitle(titles, V2, 'bai-1', 'vi')).toBe('bai-1');
    expect(resolveItemTitle(titles, null, 'bai-1', 'vi')).toBe('bai-1');
    expect(resolveCourseTitle(titles, V1.toUpperCase(), 'vi', 'python-co-ban')).toBe('Python cơ bản');
    expect(resolveCourseTitle(titles, V2, 'en', 'fallback-id')).toBe('fallback-id');
  });

  it('uses the course id when the outline meta has no title', async () => {
    const { client } = outlineClient(() => ({ data: [{ version_id: V2, course_id: 'khoa-moi', meta: {}, outline: null }], error: null }));
    const titles = await versionTitles([V2], client);
    expect(titles.get(V2)?.courseTitle).toBe('khoa-moi');
    expect(titles.get(V2)?.items.size).toBe(0);
  });

  it('batches version ids and never throws on failed reads', async () => {
    const ids = Array.from({ length: VERSION_TITLE_BATCH_SIZE + 1 }, (_, index) => `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`);
    const { client, calls } = outlineClient((batch) => batch.length === 1
      ? { data: [{ version_id: batch[0], course_id: 'c', meta: { title: 'C' }, outline: {} }], error: null }
      : { data: null, error: { message: 'boom' } });
    const titles = await versionTitles(ids, client);
    expect(calls.map((call) => call.ids.length)).toEqual([100, 1]);
    expect(titles.size).toBe(1);
    await expect(versionTitles([V1])).resolves.toEqual(new Map());
    await expect(versionTitles([])).resolves.toEqual(new Map());
  });

  it('localizes stored titles without inventing text', () => {
    expect(localizeOutlineTitle('Tiêu đề', 'en')).toBe('Tiêu đề');
    expect(localizeOutlineTitle({ vi: 'Xin chào' }, 'en')).toBe('Xin chào');
    expect(localizeOutlineTitle(undefined, 'vi')).toBeNull();
  });
});
