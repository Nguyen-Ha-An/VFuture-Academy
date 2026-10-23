import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() => vi.fn());
const notFound = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect, notFound }));

import AdminAnalyticsPage from '@/app/admin/analytics/page';
import AdminBankPage from '@/app/admin/bank/page';
import AdminBankDetailPage from '@/app/admin/bank/[id]/page';
import AdminExamsPage from '@/app/admin/exams/page';
import AdminSubmissionsPage from '@/app/admin/submissions/page';
import StudioProjectDetailPage from '@/app/admin/projects/[id]/page';
import StudioAnalyticsPage from '@/app/studio/analytics/page';
import StudioAssessmentsPage from '@/app/studio/assessments/page';
import StudioEnrollmentMigrationPage from '@/app/studio/enrollment-migration/page';
import StudioExamsPage from '@/app/studio/exams/page';
import StudioGradingPage from '@/app/studio/grading/page';
import StudioGradingDetailPage from '@/app/studio/grading/[kind]/[id]/page';
import StudioSubmissionsPage from '@/app/studio/submissions/page';

describe('superseded staff routes to their canonical workspace', () => {
  it.each([
    ['old Admin reports', AdminAnalyticsPage, '/grading/reports?branchId=vinsmc&tab=overview'],
    ['old Admin question bank', AdminBankPage, '/studio/bank?status=published'],
    ['old Admin submissions', AdminSubmissionsPage, '/grading/queue?branchId=vinsmc'],
    ['old Admin exams', AdminExamsPage, '/grading/assessments?branchId=vinsmc'],
    ['old Studio submissions', StudioSubmissionsPage, '/grading/queue?branchId=vinsmc'],
    ['old Studio exams', StudioExamsPage, '/grading/assessments?branchId=vinsmc'],
    ['old Studio grading queue', StudioGradingPage, '/grading/queue?status=submitted'],
    ['old Studio assessments', StudioAssessmentsPage, '/grading/assessments?courseId=ai'],
    ['old Studio reports', StudioAnalyticsPage, '/grading/reports?from=2026-09-01'],
    ['old Studio enrollment migration', StudioEnrollmentMigrationPage, '/admin/enrollment-migration?courseId=ai'],
  ])('redirects %s while preserving query parameters', async (_name, Page, destination) => {
    const search = new URL(destination, 'https://academy.invalid').searchParams;
    await Page({ searchParams: Promise.resolve(Object.fromEntries(search.entries())) });
    expect(redirect).toHaveBeenLastCalledWith(destination);
  });

  it('preserves an encoded item ID and repeated query values', async () => {
    await AdminBankDetailPage({ params: Promise.resolve({ id: 'bank/item' }), searchParams: Promise.resolve({ tag: ['ai', 'future'] }) });
    expect(redirect).toHaveBeenLastCalledWith('/studio/bank/bank%2Fitem?tag=ai&tag=future');
  });

  it('preserves the grading detail kind, encoded ID and back link', async () => {
    await StudioGradingDetailPage({ params: Promise.resolve({ kind: 'assignments', id: 'submission/one' }), searchParams: Promise.resolve({ back: '/grading/queue' }) });
    expect(redirect).toHaveBeenLastCalledWith('/grading/assignments/submission%2Fone?back=%2Fgrading%2Fqueue');

    await StudioGradingDetailPage({ params: Promise.resolve({ kind: 'exams', id: 'attempt 1' }), searchParams: Promise.resolve({ branchId: 'vinsmc' }) });
    expect(redirect).toHaveBeenLastCalledWith('/grading/exams/attempt%201?branchId=vinsmc');
  });

  it('does not invent a grading kind for an unknown detail bookmark', async () => {
    await StudioGradingDetailPage({ params: Promise.resolve({ kind: 'quizzes', id: 'a' }), searchParams: Promise.resolve({}) });
    expect(notFound).toHaveBeenCalled();
    expect(redirect).not.toHaveBeenLastCalledWith(expect.stringContaining('/grading/quizzes'));
  });

  it('preserves an encoded project ID and query values', async () => {
    await StudioProjectDetailPage({ params: Promise.resolve({ id: 'climate lab' }), searchParams: Promise.resolve({ preview: '1' }) });
    expect(redirect).toHaveBeenLastCalledWith('/studio/projects/climate%20lab?preview=1');
  });
});
