import { describe, expect, it } from 'vitest';

import { safeInternalPath } from '@/lib/safe-internal-path';

describe('safeInternalPath', () => {
  it.each([
    ['/app', '/app'],
    ['/app/courses/course-1?step=2#question', '/app/courses/course-1?step=2#question'],
    ['/app/projects/climate-lab?tag=ai&tag=climate', '/app/projects/climate-lab?tag=ai&tag=climate'],
    ['/account/connected-apps', '/account/connected-apps'],
    ['/home', '/home'],
    ['/learn/course-1?step=2#question', '/learn/course-1?step=2#question'],
    ['/studio/courses?draft=one', '/studio/courses?draft=one'],
    ['/grading', '/grading'],
    ['/grading/queue?tab=exams&branchId=school-a', '/grading/queue?tab=exams&branchId=school-a'],
    ['/grading/exams/attempt-1?back=%2Fgrading%2Fqueue', '/grading/exams/attempt-1?back=%2Fgrading%2Fqueue'],
    ['/profile', '/profile'],
    ['/leaderboard?scope=branch', '/leaderboard?scope=branch'],
    ['/courses/ai-foundations?enroll=1', '/courses/ai-foundations?enroll=1'],
    ['/resources/prompting-guide', '/resources/prompting-guide'],
    ['/opportunities/summer-lab?apply=1', '/opportunities/summer-lab?apply=1'],
    ['/projects/climate-lab?join=1', '/projects/climate-lab?join=1'],
  ])('keeps allow-listed path-only destination %s', (value, expected) => {
    expect(safeInternalPath(value)).toBe(expected);
  });

  it.each([
    undefined,
    'https://evil.example/profile',
    '//evil.example/profile',
    '/\\evil.example/profile',
    '/api/v1/profile',
    '/login?next=/app',
    '/signup?next=/app',
    '/welcome?next=/app',
    '/auth/callback?next=/app',
    '/homepage',
    '/account-untrusted',
    '/grading-untrusted',
  ])('falls back for unsafe or non-allow-listed destination %s', (value) => {
    expect(safeInternalPath(value)).toBe('/app');
  });
});
