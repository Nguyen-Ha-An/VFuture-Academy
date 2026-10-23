'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button, Table } from '@/components/ui/classic';
import type { Branch } from '@/features/admin/branches';
import type { BranchAnalytics } from '@/features/admin/analytics';

type Envelope<T> = { data?: T; error?: { message?: string } };

async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json() as Envelope<T>;
  if (!response.ok || body.data === undefined) throw new Error(body.error?.message ?? 'request_failed');
  return body.data;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border border-border bg-card p-5"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-2 text-3xl font-semibold tracking-tight">{value}</dd></div>;
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
    <section className="space-y-8" aria-labelledby="analytics-title">
      <div>
        <p className="font-mono text-xs font-medium tracking-[0.16em] text-primary uppercase">{t('eyebrow')}</p>
        <h1 id="analytics-title" className="mt-3 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">{t('description')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-5">
        <label className="grid min-w-56 gap-2 text-sm font-medium" htmlFor="analytics-branch">
          {t('branch')}
          <select id="analytics-branch" value={branchId} disabled={fixedBranchId !== null} onChange={(event) => setBranchId(event.target.value)} className="min-h-10 rounded-md border border-input bg-background px-3">
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
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
          <div className="rounded-lg border border-border bg-card p-5 sm:col-span-2">
            <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">{t('completionRate')}</span><strong>{completion}%</strong></div>
            <div role="img" aria-label={t('completionBar', { value: completion })} className="mt-3 h-3 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, completion))}%` }} />
            </div>
          </div>
        </dl>

        <section className="space-y-3" aria-labelledby="course-performance-title">
          <h2 id="course-performance-title" className="text-xl font-semibold">{t('coursePerformance')}</h2>
          <Table aria-label={t('coursePerformance')}>
            <thead><tr className="border-b border-border text-left"><th scope="col" className="p-3">{t('course')}</th><th scope="col" className="p-3">{t('quizAttempts')}</th><th scope="col" className="p-3">{t('examAttempts')}</th><th scope="col" className="p-3">{t('averagePercent')}</th></tr></thead>
            <tbody>{data.courses.length ? data.courses.map((course) => <tr key={course.courseId} className="border-b border-border/70"><th scope="row" className="p-3 font-mono text-left">{course.courseId}</th><td className="p-3">{course.quizAttempts}</td><td className="p-3">{course.examAttempts}</td><td className="p-3">{course.averagePercent === null ? '—' : `${course.averagePercent}%`}</td></tr>) : <tr><td colSpan={4} className="p-4 text-muted-foreground">{t('noData')}</td></tr>}</tbody>
          </Table>
        </section>

        <section className="space-y-3" aria-labelledby="failed-questions-title">
          <h2 id="failed-questions-title" className="text-xl font-semibold">{t('topFailed')}</h2>
          <Table aria-label={t('topFailed')}>
            <thead><tr className="border-b border-border text-left"><th scope="col" className="p-3">{t('course')}</th><th scope="col" className="p-3">{t('question')}</th><th scope="col" className="p-3">{t('failures')}</th><th scope="col" className="p-3">{t('attempts')}</th><th scope="col" className="p-3">{t('failureRate')}</th></tr></thead>
            <tbody>{data.topFailedQuestions.length ? data.topFailedQuestions.map((question) => <tr key={`${question.courseId}:${question.questionId}`} className="border-b border-border/70"><td className="p-3 font-mono">{question.courseId}</td><th scope="row" className="p-3 font-mono text-left">{question.questionId}</th><td className="p-3">{question.failures}</td><td className="p-3">{question.attempts}</td><td className="p-3">{question.failureRate}%</td></tr>) : <tr><td colSpan={5} className="p-4 text-muted-foreground">{t('noData')}</td></tr>}</tbody>
          </Table>
        </section>
      </> : <p className="text-muted-foreground">{t('noData')}</p>}
      <p role="status" aria-live="polite" className="min-h-6 text-sm text-muted-foreground">{status}</p>
    </section>
  );
}
