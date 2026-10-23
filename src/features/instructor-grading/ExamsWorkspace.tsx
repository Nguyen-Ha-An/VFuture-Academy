'use client';

import { FileText, LoaderCircle, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DataCard, EmptyState, StatusBadge } from '@/features/staff-ui/components';
import { readApiData, workspaceErrorMessage } from '@/features/studio/ui/client';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/ui-cn';
import { safeHttpsUrl } from './safe-url';
import type {
  BranchOption,
  CourseOption,
  ExamAttempt,
  ExamOption,
  ExamReleaseResult,
  PendingManualQuestion,
} from './types';

function AttemptCell({ label, children, className, valueClassName }: {
  label: string;
  children: ReactNode;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <TableCell className={cn('flex min-h-0 items-start justify-between gap-3 px-6 py-2 leading-normal xl:table-cell xl:h-12 xl:px-2 xl:py-3', className)}>
      <span className="shrink-0 text-xs font-medium leading-normal text-muted-foreground xl:hidden">{label}</span>
      <div className={cn('min-w-0 text-right xl:text-left', valueClassName)}>{children}</div>
    </TableCell>
  );
}

export function ExamAttemptsTable({
  attempts,
  canGrade,
  detailHref,
  onGrade,
}: {
  attempts: ExamAttempt[];
  canGrade: boolean;
  detailHref?: (attempt: ExamAttempt) => string;
  onGrade?: (attempt: ExamAttempt) => void;
}) {
  const locale = useLocale();
  const t = useTranslations('studio.exams');
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Table className="block xl:table" containerClassName="overflow-visible xl:overflow-x-auto">
      <TableHeader className="hidden xl:table-header-group">
        <TableRow className="hover:bg-transparent">
          <TableHead scope="col">{t('table.learner')}</TableHead>
          <TableHead scope="col">{t('table.attempt')}</TableHead>
          <TableHead scope="col">{t('table.status')}</TableHead>
          <TableHead scope="col">{t('table.late')}</TableHead>
          <TableHead scope="col">{t('table.percent')}</TableHead>
          <TableHead scope="col">{locale === 'vi' ? 'Kết quả' : 'Results'}</TableHead>
          <TableHead scope="col">{t('table.integrity')}</TableHead>
          <TableHead scope="col">{t('table.submittedAt')}</TableHead>
          {canGrade ? <TableHead scope="col">{t('table.action')}</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody className="block xl:table-row-group">
        {attempts.map((attempt) => (
          <TableRow key={attempt.attemptId} className="block py-3 hover:bg-muted/30 xl:table-row xl:py-0">
            <AttemptCell label={t('table.learner')} valueClassName="break-words font-semibold xl:font-medium">{attempt.learnerName}</AttemptCell>
            <AttemptCell label={t('table.attempt')} valueClassName="tabular-nums">{attempt.attemptNo}</AttemptCell>
            <AttemptCell label={t('table.status')}><StatusBadge kind="examAttempt" value={attempt.status} label={t(`status.${attempt.status}`)} /></AttemptCell>
            <AttemptCell label={t('table.late')}>{attempt.late ? t('yes') : t('no')}</AttemptCell>
            <AttemptCell label={t('table.percent')} valueClassName="tabular-nums">{attempt.percent === null ? '—' : `${attempt.percent}%`}</AttemptCell>
            <AttemptCell label={locale === 'vi' ? 'Kết quả' : 'Results'} valueClassName="max-w-48 text-pretty xl:max-w-none">{attempt.status === 'pending_manual'
              ? <span className="text-muted-foreground">{locale === 'vi' ? 'Đang chấm' : 'Grading'}</span>
              : attempt.resultAvailableAt
                ? <span>{locale === 'vi' ? 'Đã hoàn tất' : 'Complete'}</span>
                // A historical attempt has no availability marker. Released the legacy way, its
                // score is already visible to the learner, so it must not be reported as hidden.
                : attempt.releasedAt
                  ? <span>{locale === 'vi' ? 'Đã công bố (cũ)' : 'Released (legacy)'}</span>
                  : <span className="text-muted-foreground">{locale === 'vi' ? 'Chờ công bố (cũ)' : 'Awaiting legacy release'}</span>}
              {attempt.releasedAt ? <span className="mt-1 block text-xs leading-normal text-muted-foreground">{locale === 'vi' ? 'Đã công bố đáp án' : 'Answer key released'}</span> : null}</AttemptCell>
            <AttemptCell label={t('table.integrity')} valueClassName="tabular-nums">{attempt.integrityEventCount}</AttemptCell>
            <AttemptCell label={t('table.submittedAt')} valueClassName="text-muted-foreground tabular-nums xl:whitespace-nowrap">{attempt.submittedAt ? date.format(new Date(attempt.submittedAt)) : '—'}</AttemptCell>
            {canGrade ? <TableCell className="block px-6 pb-2 pt-3 xl:table-cell xl:h-12 xl:px-2 xl:py-3">{detailHref ? <Button asChild size="sm" className="w-full xl:w-auto"><Link href={detailHref(attempt)}>{t('manualGradeAction')}</Link></Button> : <Button size="sm" className="w-full xl:w-auto" onClick={() => onGrade?.(attempt)}>{t('manualGradeAction')}</Button>}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ReleaseExamDialog({
  canRelease,
  hasReleasableAttempts,
  onRelease,
  scope,
}: {
  canRelease: boolean;
  hasReleasableAttempts: boolean;
  onRelease: () => Promise<ExamReleaseResult>;
  scope?: string;
}) {
  const t = useTranslations('studio.exams');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExamReleaseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canRelease) return null;

  async function release() {
    setBusy(true);
    setError(null);
    try {
      setResult(await onRelease());
    } catch (cause) {
      setError(workspaceErrorMessage(cause, t('releaseError')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setResult(null); setError(null); } }}>
      <DialogTrigger asChild><Button disabled={!hasReleasableAttempts}>{t('releaseAction')}</Button></DialogTrigger>
        <DialogContent showCloseButton={false} aria-busy={busy} className="gap-5 p-5 sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="text-balance leading-normal">{t('releaseTitle')}</DialogTitle>
            <DialogDescription className="text-pretty leading-normal">{t('releaseDescription')}</DialogDescription>
          </DialogHeader>
          {scope ? <p className="break-words rounded-md border border-border bg-muted/50 px-3 py-2 text-sm font-medium leading-normal">{scope}</p> : null}
          {result ? (
            <div aria-live="polite" className="rounded-md border border-border bg-muted/50 p-4 text-sm leading-normal tabular-nums">
              <p className="font-semibold text-foreground">{t('releaseSummary', { released: result.released.length })}</p>
              <ul className="mt-3 grid gap-2 border-t border-border pt-3 text-muted-foreground sm:grid-cols-2">
                <li>{t('skippedForbidden', { count: result.skipped.forbidden })}</li>
                <li>{t('skippedUnassigned', { count: result.skipped.unassigned })}</li>
                <li>{t('skippedAlreadyReleased', { count: result.skipped.alreadyReleased.length })}</li>
                <li>{t('skippedNotReleasable', { count: result.skipped.notReleasable.length })}</li>
              </ul>
            </div>
          ) : null}
          {error ? <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{error}</p> : null}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={busy} className="w-full sm:w-auto">{t('close')}</Button></DialogClose>
            {!result ? <Button disabled={busy} className="w-full sm:w-auto" onClick={() => void release()}>{busy ? t('releasing') : t('confirmRelease')}</Button> : null}
          </DialogFooter>
        </DialogContent>
    </Dialog>
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

type ManualFile = { assetId: string; name: string };
type ManualLink = { url: string; label: string };

function urlLike(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function manualFile(value: unknown): ManualFile | null {
  if (typeof value === 'string' && value.length > 0 && !urlLike(value)) {
    return { assetId: value, name: value };
  }
  const file = record(value);
  return typeof file?.assetId === 'string' && file.assetId.length > 0
    ? { assetId: file.assetId, name: typeof file.name === 'string' && file.name ? file.name : file.assetId }
    : null;
}

function manualLink(value: unknown): ManualLink | null {
  const link = record(value);
  const rawUrl = typeof value === 'string' ? value : link?.url;
  const url = safeHttpsUrl(rawUrl);
  if (!url) return null;
  return { url, label: typeof link?.label === 'string' && link.label ? link.label : url };
}

function FileLinks({ files }: { files: ManualFile[] }) {
  const t = useTranslations('studio.exams');
  if (!files.length) return null;
  return (
    <ul className="space-y-2">
      {files.map((file, index) => (
        <li key={`${file.assetId}-${index}`}>
          <a className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" href={`/api/v1/media/${encodeURIComponent(file.assetId)}`} target="_blank" rel="noopener noreferrer">
            <FileText aria-hidden="true" className="size-4" />{file.name}<span className="sr-only">{t('signedFile')}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ManualAnswer({ question }: { question: PendingManualQuestion }) {
  const t = useTranslations('studio.exams');
  const answer = record(question.answer);
  const code = typeof answer?.code === 'string' ? answer.code : null;
  const answerTexts = typeof question.answer === 'string'
    ? (question.answer.length > 0 ? [question.answer] : [])
    : typeof answer?.text === 'string'
      ? (answer.text.length > 0 ? [answer.text] : [])
      : question.type === 'essay' && Array.isArray(question.answer)
        ? question.answer.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [];
  const primitiveUploadValues = question.type === 'upload_answer' && Array.isArray(question.answer)
    ? question.answer
    : [];
  const links = [
    ...(Array.isArray(answer?.links) ? answer.links : []),
    ...primitiveUploadValues,
  ].flatMap((value) => manualLink(value) ?? []);
  const files = [
    ...(Array.isArray(answer?.files) ? answer.files : []),
    ...primitiveUploadValues,
  ].flatMap((value) => manualFile(value) ?? []);
  const rendered = answerTexts.length > 0 || code !== null || links.length > 0 || files.length > 0;
  const fallback = JSON.stringify(question.answer, null, 2) ?? String(question.answer);
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('learnerAnswer')}</h4>
      {answerTexts.map((answerText, index) => <p key={index} className="whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm">{answerText}</p>)}
      {code !== null ? <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-950 p-4 text-xs text-neutral-100"><code>{code}</code></pre> : null}
      {links.length ? <ul className="space-y-1">{links.map((link, index) => <li key={`${link.url}-${index}`}><a href={link.url} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-primary underline underline-offset-4">{link.label}</a></li>)}</ul> : null}
      <FileLinks files={files} />
      {!rendered
        ? <pre className="max-h-52 overflow-auto rounded-md bg-muted p-3 text-xs">{fallback}</pre>
        : null}
    </div>
  );
}

type AttemptsResponse = {
  attempts: ExamAttempt[];
  skipped: { unassigned: number };
};

export function ExamsWorkspace({
  branches,
  courses,
  exams,
  gradingBranchIds,
  releaseBranchIds,
  canRelease,
  embedded = false,
}: {
  branches: BranchOption[];
  courses: CourseOption[];
  exams: ExamOption[];
  gradingBranchIds: string[] | null;
  releaseBranchIds?: string[] | null;
  canRelease: boolean;
  embedded?: boolean;
}) {
  const t = useTranslations('studio.exams');
  const vi = useLocale() === 'vi';
  const courseChoices = courses.filter((course) => exams.some((exam) => exam.courseId === course.id));
  const initialCourse = courseChoices[0]?.id ?? '';
  const initialExam = exams.find((exam) => exam.courseId === initialCourse);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '');
  const [filtersReady,setFiltersReady]=useState(false);
  const initialized=useRef(false);
  const [courseId, setCourseId] = useState(initialCourse);
  const [examKey, setExamKey] = useState(initialExam ? `${initialExam.courseVersionId}:${initialExam.itemId}` : '');
  useEffect(()=>{
    if(initialized.current)return;initialized.current=true;
    const q=new URLSearchParams(window.location.search);
    if(branches.some(b=>b.id===q.get('branchId')))setBranchId(q.get('branchId')!);
    const selected=exams.find(e=>e.courseVersionId===q.get('courseVersionId')&&e.itemId===q.get('itemId'));
    if(selected){setCourseId(selected.courseId);setExamKey(`${selected.courseVersionId}:${selected.itemId}`);}
    else if(courses.some(c=>c.id===q.get('courseId'))){const first=exams.find(e=>e.courseId===q.get('courseId'));setCourseId(q.get('courseId')!);setExamKey(first?`${first.courseVersionId}:${first.itemId}`:'');}
    setFiltersReady(true);
  },[branches,courses,exams]);
  useEffect(()=>{
    if(!filtersReady)return;
    const q=new URLSearchParams(window.location.search);const selected=exams.find(e=>`${e.courseVersionId}:${e.itemId}`===examKey);
    for(const [key,value] of Object.entries({branchId,courseId,courseVersionId:selected?.courseVersionId??'',itemId:selected?.itemId??''})){if(value)q.set(key,value);else q.delete(key);}
    window.history.replaceState(window.history.state,'',`${window.location.pathname}?${q}`);
  },[filtersReady,branchId,courseId,examKey,exams]);

  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [skippedUnassigned, setSkippedUnassigned] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const examChoices = exams.filter((exam) => exam.courseId === courseId);
  const selectedExam = exams.find((exam) => `${exam.courseVersionId}:${exam.itemId}` === examKey);
  const selectedBranchName = branches.find((branch) => branch.id === branchId)?.name;
  const canGradeSelectedBranch = branchId.length > 0
    && (gradingBranchIds === null || gradingBranchIds.includes(branchId));
  const canReleaseSelectedBranch = branchId.length > 0
    && (releaseBranchIds === undefined ? canRelease : releaseBranchIds === null || releaseBranchIds.includes(branchId));
  const canAccessSelectedBranch = canGradeSelectedBranch || canReleaseSelectedBranch;
  const hasReleasableAttempts = attempts.some((attempt) =>
    attempt.status === 'graded' && attempt.releasedAt === null);
  const loadErrorFallback = t('loadError');
  const selectedExamLabel = selectedExam
    ? t('examOption', { title: selectedExam.itemTitle, version: selectedExam.version })
    : null;
  const releaseExplanation = vi
    ? 'Công bố đáp án và kết quả cũ. Điểm của lượt thi vừa hoàn tất chấm đã hiển thị cho học viên.'
    : 'Publishes answer keys and legacy results. Scores of newly completed attempts are already visible to learners.';
  const noAccessMessage = branches.length
    ? (vi ? 'Bạn không có quyền xem lượt thi trong chi nhánh này.' : 'You cannot view exam attempts in this branch.')
    : (vi ? 'Chưa có chi nhánh khả dụng.' : 'No branches are available.');

  useEffect(() => {
    if (!filtersReady || !selectedExam || !branchId || !canAccessSelectedBranch) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ branchId, courseVersionId: selectedExam.courseVersionId });
    setLoading(true);
    setError(null);
    void fetch(`/api/v1/studio/exams/${encodeURIComponent(selectedExam.itemId)}/attempts?${params}`, { signal: controller.signal })
      .then((response) => readApiData<AttemptsResponse>(response))
      .then((result) => { setAttempts(result.attempts); setSkippedUnassigned(result.skipped.unassigned); })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(workspaceErrorMessage(cause, loadErrorFallback));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [branchId, canAccessSelectedBranch, selectedExam, loadErrorFallback, filtersReady]);

  function clearSelectedAttempts() {
    setAttempts([]);
    setSkippedUnassigned(0);
    setLoading(false);
    setError(null);
    setAnnouncement('');
  }

  function chooseBranch(nextBranchId: string) {
    clearSelectedAttempts();
    setBranchId(nextBranchId);
  }

  function chooseCourse(nextCourseId: string) {
    clearSelectedAttempts();
    setCourseId(nextCourseId);
    const nextExam = exams.find((exam) => exam.courseId === nextCourseId);
    setExamKey(nextExam ? `${nextExam.courseVersionId}:${nextExam.itemId}` : '');
  }

  async function releaseExam(): Promise<ExamReleaseResult> {
    if (!selectedExam) throw new Error('No exam selected');
    const result = await readApiData<ExamReleaseResult>(await fetch(`/api/v1/studio/exams/${encodeURIComponent(selectedExam.itemId)}/release`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ branchId, courseVersionId: selectedExam.courseVersionId }),
    }));
    const released = new Map(result.released.map((entry) => [entry.attemptId, entry.releasedAt]));
    setAttempts((current) => current.map((attempt) => released.has(attempt.attemptId)
      ? { ...attempt, releasedAt: released.get(attempt.attemptId)! }
      : attempt));
    setAnnouncement(t('releaseSummary', { released: result.released.length }));
    return result;
  }

  // The workbench's back link returns to the list the grader is on (queue or assessments), with
  // the filters this workspace keeps in the URL; rows only render after the client fetch.
  const currentListHref = () => typeof window === 'undefined'
    ? routes.grading.assessments({ branchId, courseId, exam: examKey })
    : `${window.location.pathname}${window.location.search}`;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {!embedded ? (
        <header className="border-b border-border pb-6">
          <div className="min-w-0">
            <p className="text-xs font-medium leading-normal text-muted-foreground">{t('eyebrow')}</p>
            <h1 className="mt-1 text-2xl font-bold leading-[1.4] tracking-tight text-balance">{t('title')}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-normal text-muted-foreground text-pretty">{t('description')}</p>
          </div>
        </header>
      ) : null}
      <div aria-live="polite" className="sr-only">{announcement}</div>
      <DataCard
        title={selectedExamLabel ?? t('title')}
        description={selectedExamLabel ? [selectedBranchName, canReleaseSelectedBranch ? releaseExplanation : null].filter(Boolean).join(' · ') : undefined}
        actions={selectedExamLabel && canReleaseSelectedBranch ? (
          <ReleaseExamDialog
            canRelease={canReleaseSelectedBranch}
            hasReleasableAttempts={hasReleasableAttempts}
            onRelease={releaseExam}
            scope={[selectedBranchName, selectedExamLabel].filter(Boolean).join(' · ')}
          />
        ) : undefined}
        aria-busy={loading}
        toolbar={<section aria-label={t('filters.label')} className="grid min-w-0 gap-3 md:grid-cols-3">
          <label className="grid gap-2 text-sm font-medium leading-normal" htmlFor="exam-branch-filter">{t('filters.branch')}<NativeSelect id="exam-branch-filter" wrapperClassName="w-full" value={branchId} onChange={(event) => chooseBranch(event.target.value)}>{branches.map((branch) => <NativeSelectOption key={branch.id} value={branch.id}>{branch.name}</NativeSelectOption>)}</NativeSelect></label>
          <label className="grid gap-2 text-sm font-medium leading-normal" htmlFor="exam-course-filter">{t('filters.course')}<NativeSelect id="exam-course-filter" wrapperClassName="w-full" value={courseId} onChange={(event) => chooseCourse(event.target.value)}>{courseChoices.map((course) => <NativeSelectOption key={course.id} value={course.id}>{course.title}</NativeSelectOption>)}</NativeSelect></label>
          <label className="grid gap-2 text-sm font-medium leading-normal" htmlFor="exam-item-filter">{t('filters.exam')}<NativeSelect id="exam-item-filter" wrapperClassName="w-full" value={examKey} onChange={(event) => { clearSelectedAttempts(); setExamKey(event.target.value); }}>{examChoices.map((exam) => <NativeSelectOption key={`${exam.courseVersionId}:${exam.itemId}`} value={`${exam.courseVersionId}:${exam.itemId}`}>{t('examOption', { title: exam.itemTitle, version: exam.version })}</NativeSelectOption>)}</NativeSelect></label>
        </section>}
      >
        {!canAccessSelectedBranch || !branches.length ? <EmptyState className="m-4" icon={<ShieldAlert />} title={noAccessMessage} /> : null}
        {loading && canAccessSelectedBranch ? <p className="flex items-center gap-2 px-6 py-4 text-sm leading-normal text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />{t('loading')}</p> : null}
        {error && canAccessSelectedBranch ? <p role="alert" className="m-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-normal text-destructive-soft-foreground">{error}</p> : null}
        {skippedUnassigned && canAccessSelectedBranch ? <p className="m-6 flex items-center gap-2 rounded-md border border-warning-border bg-warning p-3 text-sm leading-normal text-warning-foreground"><ShieldAlert aria-hidden="true" className="size-4 shrink-0" />{t('unassignedSkipped', { count: skippedUnassigned })}</p> : null}
        {!loading && canAccessSelectedBranch && !selectedExam ? <EmptyState className="m-4" icon={<FileText />} title={vi ? 'Chưa có bài thi trong phạm vi này.' : 'No exams are available in this scope.'} /> : null}
        {!loading && canAccessSelectedBranch && selectedExam && !attempts.length && !error ? <EmptyState className="m-4" icon={<FileText />} title={t('empty')} /> : null}
        {attempts.length && canAccessSelectedBranch ? <ExamAttemptsTable attempts={attempts} canGrade={canGradeSelectedBranch} detailHref={(attempt) => routes.grading.exam(attempt.attemptId, { branchId, courseId, exam: examKey, back: currentListHref() })} /> : null}
      </DataCard>
    </div>
  );
}
