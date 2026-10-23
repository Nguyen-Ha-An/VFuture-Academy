import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartCard, DataCard, StatCard, StatGrid } from '@/features/staff-ui/components';
import { routes } from '@/lib/routes';
import { safeInternalHref } from '@/features/instructor-grading/safe-url';
import type { StudioLearningReport } from '../contracts';
import type { ReportCopy } from './messages';

const kinds = ['quiz', 'exam', 'assignment'] as const;
export function percent(value: number | null | undefined, empty: string): string {
  return value == null ? empty : `${Math.round(value * 100) / 100}%`;
}
/**
 * The report's `sourceHref` is produced server-side and still points at a pre-split grading path.
 * It is validated against the back-link allowlist so a report row can only ever link into a
 * grading queue or assessment list, never at some other route.
 */
function questionHref(sourceHref: unknown, branchId: string | null): string | null {
  const safe = safeInternalHref(sourceHref);
  if (!safe) return null;
  if (!branchId) return safe;
  const url = new URL(safe, 'http://internal.invalid');
  url.searchParams.set('branchId', branchId);
  return `${url.pathname}${url.search}`;
}

function Empty({ label }: { label: string }) {
  return <p className="px-6 py-10 text-center text-sm leading-normal text-muted-foreground">{label}</p>;
}

/**
 * Every report number is a snapshot of the selected period (or, for the workload tab, of now), so
 * no card carries a delta: the report has no previous period with the same definition to compare.
 */
export function ReportPanels({data, tab, copy: t, locale,canGrade}: {data: StudioLearningReport; tab: number; copy: ReportCopy; locale: string;canGrade:boolean}) {
  const s = useTranslations('staffUi.grading.reports');
  if (tab === 0) return <div className="space-y-6">
    <StatGrid className="xl:grid-cols-3">
      <StatCard label={t.active} value={data.overview.activeUsers}/>
      <StatCard label={t.enrollments} value={data.overview.newEnrollments}/>
      <StatCard label={t.completion} value={percent(data.overview.cohort.completionRate,t.empty)} hint={t.cohortHint}/>
    </StatGrid>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start">
      <ChartCard
        title={s('attempts.title')}
        description={s('attempts.description')}
        kind="bar"
        data={kinds.map((kind) => ({ kind: t[kind], attempts: data.overview.attempts[kind] }))}
        categoryKey="kind"
        categoryLabel={t.type}
        series={[{ key: 'attempts', label: s('attempts.series') }]}
        emptyLabel={t.empty}
        height={220}
      />
      <DataCard title={s('outcomes')} description={t.averageHint}>
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">{[t.type,t.attempts,t.average,t.passed].map(h=><TableHead scope="col" key={h}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{kinds.map(kind=><TableRow key={kind}>
            <TableHead scope="row" className="font-medium text-foreground">{t[kind]}</TableHead>
            <TableCell className="tabular-nums">{data.overview.attempts[kind]}</TableCell>
            <TableCell className="whitespace-normal py-3 tabular-nums leading-normal">{percent(data.overview.averages[kind].percent,t.empty)}<p className="mt-1 text-xs text-muted-foreground">{data.overview.averages[kind].sampleSize} {t.sample}</p></TableCell>
            <TableCell className="whitespace-normal py-3 tabular-nums leading-normal">{percent(data.overview.passRates[kind].percent,t.empty)}<p className="mt-1 text-xs text-muted-foreground">{data.overview.passRates[kind].sampleSize} {t.sample}</p></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </DataCard>
    </div>
  </div>;
  if (tab === 1) return <DataCard title={s('courses')}>
    {data.courses.length ? <Table>
      <TableHeader><TableRow className="hover:bg-transparent">{[t.course,t.enrollments,t.completion,t.quiz,t.exam,t.assignment].map(h=><TableHead scope="col" key={h}>{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{data.courses.map(course=><TableRow key={course.courseId}>
        <TableHead scope="row" className="min-w-48 whitespace-normal py-3 font-medium leading-normal text-foreground">{course.title || course.courseId}</TableHead>
        <TableCell className="tabular-nums">{course.newEnrollments}</TableCell>
        <TableCell className="tabular-nums">{percent(course.completionRate,t.empty)}</TableCell>
        {kinds.map(kind=><TableCell key={kind} className="whitespace-normal py-3 tabular-nums leading-normal">{course.attempts[kind]} {t.attempts}<p className="mt-1 text-xs text-muted-foreground">{t.average}: {percent(course.averages[kind].percent,t.empty)} · {course.averages[kind].sampleSize} {t.sample}</p></TableCell>)}
      </TableRow>)}</TableBody>
    </Table> : <Empty label={t.empty}/>}
  </DataCard>;
  if (tab === 2) return <DataCard title={s('questions')}>
    {data.questions.length ? <Table>
      <TableHeader><TableRow className="hover:bg-transparent">{[t.question,t.version,t.zero,t.graded,t.zeroRate].map(h=><TableHead scope="col" key={h}>{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{data.questions.map(q=>{const href=canGrade?questionHref(q.sourceHref,data.filters.branchId):null;return <TableRow key={`${q.courseVersionId}:${q.itemId}:${q.questionId}:${q.questionVersionId}`}>
        <TableHead scope="row" className="min-w-56 whitespace-normal py-3 font-normal leading-normal text-foreground"><p className="font-medium">{q.prompt || q.questionId}</p><p className="mt-1 text-xs text-muted-foreground">{q.itemTitle}</p>{href&&<Link className="mt-2 inline-flex min-h-9 items-center text-sm font-medium underline underline-offset-4" href={href}>{t.viewQuestion}</Link>}<p className="mt-1 text-xs text-muted-foreground">{data.courses.find(c=>c.courseId===q.courseId)?.title || q.courseId}</p></TableHead>
        <TableCell className="text-xs text-muted-foreground">{q.questionVersionId || q.courseVersionId}</TableCell>
        <TableCell className="tabular-nums">{q.zeroPointAnswers}</TableCell>
        <TableCell className="tabular-nums">{q.gradedAnswers}</TableCell>
        <TableCell className="tabular-nums">{percent(q.zeroPointRate,t.empty)}</TableCell>
      </TableRow>;})}</TableBody>
    </Table> : <Empty label={t.empty}/>}
  </DataCard>;
  const gradingHref = routes.grading.queue({
    ...(data.filters.branchId ? {branchId:data.filters.branchId} : {}),
    ...(data.filters.courseId ? {courseId:data.filters.courseId} : {}),
    back: routes.grading.reports(),
  });
  return <section aria-labelledby="report-workload-title" className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="report-workload-title" className="text-base font-semibold leading-normal">{t.current}</h2>
        <p className="text-sm leading-normal text-muted-foreground tabular-nums">{t.asOf} {new Date(data.grading.asOf).toLocaleString(locale,{timeZone:'Asia/Ho_Chi_Minh'})}</p>
      </div>
      {canGrade&&<Button asChild><Link href={gradingHref}>{t.openGrading}</Link></Button>}
    </div>
    <StatGrid className="xl:grid-cols-3">
      <StatCard label={t.assignmentsPending} value={data.grading.assignments.pending}/>
      <StatCard label={t.examsPending} value={data.grading.exams.pendingManualAttempts}/>
      <StatCard label={t.questionsPending} value={data.grading.exams.pendingManualQuestions}/>
      <StatCard label={`${t.assignment} · ${t.unpublished}`} value={data.grading.assignments.unpublished}/>
      <StatCard label={`${t.exam} · ${t.unpublished}`} value={data.grading.exams.unpublished}/>
    </StatGrid>
  </section>;
}
