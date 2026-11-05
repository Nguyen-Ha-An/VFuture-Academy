import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn((destination: string): never => { throw new Error(`NEXT_REDIRECT:${destination}`); }));
vi.mock('next/navigation', () => ({ redirect }));

const aliases = [
  { route: '/admin/analytics', destination: '/grading/reports', load: () => import('@/app/admin/analytics/page') },
  { route: '/admin/submissions', destination: '/grading/queue', load: () => import('@/app/admin/submissions/page') },
  { route: '/admin/exams', destination: '/grading/assessments', load: () => import('@/app/admin/exams/page') },
  { route: '/admin/cms', destination: '/studio/library', load: () => import('@/app/admin/cms/page') },
  { route: '/admin/reviews', destination: '/studio/reviews', load: () => import('@/app/admin/reviews/page') },
  { route: '/admin/bank', destination: '/studio/bank', load: () => import('@/app/admin/bank/page') },
  { route: '/admin/bank/[id]', destination: '/studio/bank/entry%2Ev1', load: () => import('@/app/admin/bank/[id]/page') },
  { route: '/admin/resources', destination: '/studio/resources', load: () => import('@/app/admin/resources/page') },
  { route: '/admin/resources/[id]', destination: '/studio/resources/entry%2Ev1', load: () => import('@/app/admin/resources/[id]/page') },
  { route: '/admin/opportunities', destination: '/studio/opportunities', load: () => import('@/app/admin/opportunities/page') },
  { route: '/admin/opportunities/[id]', destination: '/studio/opportunities/entry%2Ev1', load: () => import('@/app/admin/opportunities/[id]/page') },
  { route: '/admin/projects', destination: '/studio/projects', load: () => import('@/app/admin/projects/page') },
  { route: '/admin/projects/[id]', destination: '/studio/projects/entry%2Ev1', load: () => import('@/app/admin/projects/[id]/page') },
];

beforeEach(() => { redirect.mockClear(); });
describe('the 13 actual Admin redirect page functions', () => {
  for (const alias of aliases) it(`${alias.route} preserves query and identifiers at its canonical destination`, async () => {
    const routeModule = await alias.load();
    const page = routeModule.default as (props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[]>> }) => Promise<void>;
    await expect(page({ params: Promise.resolve({ id: 'entry.v1' }), searchParams: Promise.resolve({ q: 'revision & scope', page: '2', tag: ['first', 'second'] }) })).rejects.toThrow('NEXT_REDIRECT:');
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith(`${alias.destination}?q=revision+%26+scope&page=2&tag=first&tag=second`);
  });
});
