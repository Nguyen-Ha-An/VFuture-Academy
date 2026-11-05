'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Table } from '@/components/ui/classic';
import { CanvasButton as Button, CanvasSelect } from '@/features/canvas/ui';
import type { Branch } from '@/features/admin/branches';
import type { BranchAnalytics } from '@/features/admin/analytics';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';

type Envelope<T> = { data?: T; error?: { message?: string } };

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json() as Envelope<T>;
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? 'request_failed');
  return body.data;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="canvas-panel min-w-0 p-4"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</dd></div>;
}

export function AnalyticsDashboard({
  branches,
  fixedBranchId,
  initialData,
}: {
  branches: Branch[];
  fixedBranchId: string | null;
  initialData: BranchAnalytics | null;
}) {
  const t = useTranslations('studio.analytics');
  const [branchId, setBranchId] = useState(fixedBranchId ?? initialData?.branchId ?? branches[0]?.id ?? '');
  const [data, setData] = useState(initialData);
  const [status, setStatus] = useState('');
  const requestGenerationRef = useRef(0);
  const activeBranchRef = useRef<string | null>(null);

  async function load() {
    if (!branchId) return;
    if (activeBranchRef.current === branchId) return;
    const generation = ++requestGenerationRef.current;
    activeBranchRef.current = branchId;
    setStatus(t('loading'));
    try {
      const result = await responseData<BranchAnalytics>(await fetch(`/api/v1/studio/analytics/branch/${encodeURIComponent(branchId)}`));
      if (requestGenerationRef.current !== generation) return;
      setData(result);
      setStatus('');
    } catch (error) {
      if (requestGenerationRef.current === generation) {
        setStatus(error instanceof Error && error.message !== 'request_failed' ? error.message : t('loadError'));
      }
    } finally {
      if (requestGenerationRef.current === generation) activeBranchRef.current = null;
    }
  }

  const completion = data?.lessonCompletionRate ?? 0;
  return (
    <section className="canvas-page space-y-6" aria-label={t('title')}>
      <StaffPageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('description')} />

      <div className="canvas-toolbar flex flex-wrap items-end gap-3 p-4">
        <div className="w-full min-w-0 sm:w-auto sm:min-w-56">
          <CanvasSelect label={t('branch')} id="analytics-branch" value={branchId} disabled={fixedBranchId !== null} onChange={setBranchId} options={branches.map((branch) => ({ value: branch.id, label: branch.name }))} />
        </div>
        {fixedBranchId === null && <Button onClick={load} disabled={!branchId}>{t('load')}</Button>}
        {data && <p className="pb-2 text-sm text-muted-foreground">{t('period', data.period)}</p>}
      </div>

      {data ? <>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label={t('active7')} value={data.activeLearners.days7} />
          <Metric label={t('active30')} value={data.activeLearners.days30} />
          <Metric label={t('enrollments')} value={data.enrollments} />
          <Metric label={t('pendingGrading')} value={data.pendingGradingCount} />
          <Metric label={t('quizAttempts')} value={data.attempts.quiz} />
          <Metric label={t('examAttempts')} value={data.attempts.exam} />
          <div className="canvas-panel p-4 sm:col-span-2">
            <dt className="text-sm text-muted-foreground">{t('completionRate')}</dt>
            <dd className="mt-2">
              <strong className="tabular-nums">{completion}%</strong>
              <div role="img" aria-label={t('completionBar', { value: completion })} className="mt-3 h-3 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, completion))}%` }} />
              </div>
            </dd>
          </div>
        </dl>

        <section className="canvas-panel min-w-0 space-y-3 overflow-hidden" aria-labelledby="course-performance-title">
          <h2 id="course-performance-title" className="px-4 pt-4 text-base font-semibold">{t('coursePerformance')}</h2>
          <Table className="canvas-table" tabIndex={0} aria-label={t('coursePerformance')}>
            <thead><tr className="border-b border-border text-left"><th scope="col" className="p-3">{t('course')}</th><th scope="col" className="p-3">{t('quizAttempts')}</th><th scope="col" className="p-3">{t('examAttempts')}</th><th scope="col" className="p-3">{t('averagePercent')}</th></tr></thead>
            <tbody>{data.courses.length ? data.courses.map((course) => <tr key={course.courseId} className="border-b border-border/70"><th scope="row" className="p-3 font-mono text-left">{course.courseId}</th><td className="p-3">{course.quizAttempts}</td><td className="p-3">{course.examAttempts}</td><td className="p-3">{course.averagePercent === null ? '—' : `${course.averagePercent}%`}</td></tr>) : <tr><td colSpan={4} className="p-4 text-muted-foreground">{t('noData')}</td></tr>}</tbody>
          </Table>
        </section>

        <section className="canvas-panel min-w-0 space-y-3 overflow-hidden" aria-labelledby="failed-questions-title">
          <h2 id="failed-questions-title" className="px-4 pt-4 text-base font-semibold">{t('topFailed')}</h2>
          <Table className="canvas-table" tabIndex={0} aria-label={t('topFailed')}>
            <thead><tr className="border-b border-border text-left"><th scope="col" className="p-3">{t('course')}</th><th scope="col" className="p-3">{t('question')}</th><th scope="col" className="p-3">{t('failures')}</th><th scope="col" className="p-3">{t('attempts')}</th><th scope="col" className="p-3">{t('failureRate')}</th></tr></thead>
            <tbody>{data.topFailedQuestions.length ? data.topFailedQuestions.map((question) => <tr key={`${question.courseId}:${question.questionId}`} className="border-b border-border/70"><td className="p-3 font-mono">{question.courseId}</td><th scope="row" className="p-3 font-mono text-left">{question.questionId}</th><td className="p-3">{question.failures}</td><td className="p-3">{question.attempts}</td><td className="p-3">{question.failureRate}%</td></tr>) : <tr><td colSpan={5} className="p-4 text-muted-foreground">{t('noData')}</td></tr>}</tbody>
          </Table>
        </section>
      </> : <p className="canvas-empty text-muted-foreground">{t('noData')}</p>}
      <p role="status" aria-live="polite" className="min-h-6 text-sm text-muted-foreground">{status}</p>
    </section>
  );
}
