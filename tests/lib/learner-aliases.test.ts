import { beforeEach, describe, expect, it, vi } from 'vitest';
const redirect = vi.hoisted(() => vi.fn((href: string): never => { throw new Error(`redirect:${href}`); }));
const notFound = vi.hoisted(() => vi.fn((): never => { throw new Error('not_found'); }));
vi.mock('next/navigation', () => ({ redirect, notFound }));
import Home from '@/app/(learner)/home/page';
import Courses from '@/app/(learner)/learn/page';
import Course from '@/app/(learner)/learn/[courseId]/page';
import Item from '@/app/(learner)/learn/[courseId]/items/[itemId]/page';
import Profile from '@/app/(learner)/profile/page';
import Leaderboard from '@/app/(learner)/leaderboard/page';
import Projects from '@/app/(learner)/build/page';
import Project from '@/app/(learner)/build/[id]/page';
import Missing from '@/app/app/[...missing]/page';
const query = { from: 'legacy', language: 'en', tag: ['one', 'two'] };
const suffix = '?from=legacy&language=en&tag=one&tag=two';
beforeEach(() => { redirect.mockClear(); });
describe('all retained learner aliases use actual canonical redirect pages', () => {
  it.each([
    ['/home', () => Home({ searchParams: Promise.resolve(query) }), '/app'],
    ['/learn', () => Courses({ searchParams: Promise.resolve(query) }), '/app/courses'],
    ['/learn/[courseId]', () => Course({ params: Promise.resolve({ courseId: 'course/one' }), searchParams: Promise.resolve(query) }), '/app/courses/course%2Fone'],
    ['/learn/[courseId]/items/[itemId]', () => Item({ params: Promise.resolve({ courseId: 'course/one', itemId: 'item?#one' }), searchParams: Promise.resolve(query) }), '/app/courses/course%2Fone/items/item%3F%23one'],
    ['/profile', () => Profile({ searchParams: Promise.resolve(query) }), '/app/profile'],
    ['/leaderboard', () => Leaderboard({ searchParams: Promise.resolve(query) }), '/app/leaderboard'],
    ['/build', () => Projects({ searchParams: Promise.resolve(query) }), '/app/projects'],
    ['/build/[id]', () => Project({ params: Promise.resolve({ id: 'project/one' }), searchParams: Promise.resolve(query) }), '/app/projects/project%2Fone'],
  ] as const)('%s preserves query and encoded identity', async (_route, render, canonical) => {
    await expect(render()).rejects.toThrow(`redirect:${canonical}${suffix}`);
    expect(redirect).toHaveBeenCalledExactlyOnceWith(`${canonical}${suffix}`);
  });
  it('uses the actual catch-all page to reject unknown learner destinations', () => {
    expect(() => Missing()).toThrow('not_found');
    expect(notFound).toHaveBeenCalledOnce();
  });
});
