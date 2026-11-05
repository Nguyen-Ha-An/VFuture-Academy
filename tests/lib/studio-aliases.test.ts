import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ redirect: vi.fn((url: string): never => { throw new Error(`REDIRECT:${url}`); }), notFound: vi.fn((): never => { throw new Error('NOT_FOUND'); }) }));
vi.mock('next/navigation', () => navigation);

const aliases = [
  ['analytics', '/grading/reports', () => import('@/app/studio/analytics/page')],
  ['assessments', '/grading/assessments', () => import('@/app/studio/assessments/page')],
  ['audit', '/admin/audit', () => import('@/app/studio/audit/page')],
  ['branches', '/admin/branches', () => import('@/app/studio/branches/page')],
  ['enrollment-migration', '/admin/enrollment-migration', () => import('@/app/studio/enrollment-migration/page')],
  ['exams', '/grading/assessments', () => import('@/app/studio/exams/page')],
  ['grading', '/grading/queue', () => import('@/app/studio/grading/page')],
  ['submissions', '/grading/queue', () => import('@/app/studio/submissions/page')],
  ['users', '/admin/users', () => import('@/app/studio/users/page')],
] as const;

beforeEach(() => vi.clearAllMocks());

describe('actual Studio legacy route redirects', () => {
  for (const [name, canonical, load] of aliases) it(`${name} calls its canonical redirect and preserves repeated query values`, async () => {
    const page = (await load()).default;
    await expect(page({ searchParams: Promise.resolve({ page: '2', tag: ['science', 'AI & art'] }) })).rejects.toThrow('REDIRECT:');
    expect(navigation.redirect).toHaveBeenCalledOnce();
    const destination = new URL(navigation.redirect.mock.calls[0]![0], 'https://fixture.local');
    expect(destination.pathname).toBe(canonical);
    expect(destination.searchParams.get('page')).toBe('2');
    expect(destination.searchParams.getAll('tag')).toEqual(['science', 'AI & art']);
  });
  for (const kind of ['assignments', 'exams']) it(`grading/${kind}/[id] preserves the record identity and query`, async () => {
    const page = (await import('@/app/studio/grading/[kind]/[id]/page')).default;
    await expect(page({ params: Promise.resolve({ kind, id: 'fixture-record' }), searchParams: Promise.resolve({ branch: 'school-1' }) })).rejects.toThrow('REDIRECT:');
    expect(navigation.redirect).toHaveBeenCalledWith(`/grading/${kind}/fixture-record?branch=school-1`);
  });
  it('rejects an unknown grading kind instead of inventing a workspace redirect', async () => {
    const page = (await import('@/app/studio/grading/[kind]/[id]/page')).default;
    await expect(page({ params: Promise.resolve({ kind: 'unknown', id: 'fixture-record' }) })).rejects.toThrow('NOT_FOUND');
    expect(navigation.redirect).not.toHaveBeenCalled();
  });
});
