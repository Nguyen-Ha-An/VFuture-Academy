'use client';

import { useId, useRef, useState } from 'react';
import type { AssignmentBlock, AssignmentBody } from '../schema/types';
import type { LearnerItem } from '../compile';
import type { AssignmentPayload, LessonRuntime } from './runtime';
import { compareAssignmentTimestamps, type AssignmentSessionResult, type AssignmentTarget, type LearnerSubmissionStatus } from './assignment-contracts';
import type { BlockRendererProps } from './registry';
import { RichContentView } from './RichContentView';
import { asRich, asText } from './text';
import { SubmissionFields } from './questions/UploadAnswer';
import { t } from './questions/types';
import { useSectionTag } from './render-context';
import type { HeadingTag } from './heading-shift';
import { stateTagClass, type Tone } from './tone';

type Stored = {
  status: 'draft' | LearnerSubmissionStatus;
  payload: AssignmentPayload;
  submittedAt?: string;
  updatedAt?: string;
  completed?: boolean;
};

function localizedFeedback(value: string | { vi?: string; en?: string }, locale: 'vi' | 'en'): string {
  if (typeof value === 'string') return value.trim();
  return [value[locale], value.vi, value.en].find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim() ?? '';
}

function newerLocalDraft(stored: Stored | undefined, session: AssignmentSessionResult | undefined): boolean {
  if (!stored || stored.status !== 'draft') return false;
  const latest = session?.submissions[0];
  if (!latest) return true;
  return stored.updatedAt
    ? compareAssignmentTimestamps(stored.updatedAt, latest.submittedAt) === 1
    : false;
}

function errorCode(value: unknown): string | null {
  return typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
    ? value.code
    : null;
}

function submissionPayload(submission: AssignmentSessionResult['submissions'][number]): AssignmentPayload {
  return { ...submission.payload, files: submission.files };
}

type AssignmentStatus = 'draft' | LearnerSubmissionStatus;
type Rubric = { criteria: { id: string; name: string; description?: string; maxPoints: number }[] };

function statusLabel(status: AssignmentStatus, locale: 'vi' | 'en'): string {
  return {
    draft: t(locale, 'Chưa nộp', 'Not submitted'),
    submitted: t(locale, 'Đã nộp', 'Submitted'),
    in_review: t(locale, 'Đang chấm', 'In review'),
    approved: t(locale, 'Đã duyệt', 'Approved'),
    changes_requested: t(locale, 'Cần chỉnh sửa', 'Changes requested'),
  }[status];
}

/** Bench tones: waiting is pending, approved is signal, changes requested is fault, a draft is neutral. */
const STATUS_TONES: Record<AssignmentStatus, Tone> = {
  draft: 'neutral',
  submitted: 'pending',
  in_review: 'pending',
  approved: 'signal',
  changes_requested: 'fault',
};

function StatusTag({ status, locale }: { status: AssignmentStatus; locale: 'vi' | 'en' }) {
  return <span data-status={status} className={`${stateTagClass(STATUS_TONES[status])} shrink-0 gap-2`}>
    <span aria-hidden="true" className="size-1.5 bg-current" />
    {statusLabel(status, locale)}
  </span>;
}

function AssignmentRubric({ rubric, locale }: { rubric: Rubric; locale: 'vi' | 'en' }) {
  return <div className="mt-4 divide-y divide-border border-y border-border">
    {rubric.criteria.map((criterion) => <div key={criterion.id} className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-3 sm:flex-nowrap">
      <div className="min-w-0">
        <p className="font-medium text-foreground">{criterion.name}</p>
        {criterion.description ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{criterion.description}</p> : null}
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{t(locale, `${criterion.maxPoints} điểm`, `${criterion.maxPoints} points`)}</span>
    </div>)}
  </div>;
}

function ReleasedFeedback({
  grade,
  status,
  locale,
  headingAs: Heading,
}: {
  grade: NonNullable<AssignmentSessionResult['submissions'][number]['grade']>;
  status: LearnerSubmissionStatus;
  locale: 'vi' | 'en';
  headingAs: HeadingTag;
}) {
  const feedback = localizedFeedback(grade.feedback, locale);
  const tone = status === 'changes_requested'
    ? 'border-warning-border bg-warning text-warning-foreground'
    : 'border-success-border bg-success text-success-foreground';
  return <section aria-label={t(locale, 'Phản hồi mới nhất', 'Latest feedback')} className={`border-l-2 px-4 py-4 sm:px-5 ${tone}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Heading className="text-sm font-semibold">{t(locale, 'Phản hồi mới nhất', 'Latest feedback')}</Heading>
      <span className="text-sm font-semibold tabular-nums">{t(locale, `Điểm: ${grade.totalPoints} trên ${grade.maxPoints}`, `Score: ${grade.totalPoints} of ${grade.maxPoints}`)}</span>
    </div>
    {feedback ? <p className="mt-3 whitespace-pre-wrap text-[1.125rem] italic leading-relaxed" style={{ fontFamily: "'Newsreader', Georgia, serif" }}>{feedback}</p> : null}
    <p className="mt-2 text-xs tabular-nums">{t(locale, 'Chấm lúc', 'Graded')} <time dateTime={grade.gradedAt}>{new Date(grade.gradedAt).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-GB')}</time></p>
  </section>;
}

function SubmissionHistory({
  session,
  runtime,
  headingId,
  headingAs: Heading,
}: {
  session: AssignmentSessionResult;
  runtime: LessonRuntime;
  headingId: string;
  headingAs: HeadingTag;
}) {
  const L = runtime.locale;
  return <section className="border-t border-border pt-6" aria-labelledby={headingId}>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <Heading id={headingId} className="text-base font-semibold">{t(L, 'Lịch sử bài nộp', 'Submission history')}</Heading>
      <p className="text-xs tabular-nums text-muted-foreground">{t(L, `${session.submissions.length} lần nộp`, `${session.submissions.length} ${session.submissions.length === 1 ? 'attempt' : 'attempts'}`)}</p>
    </div>
    <ol className="mt-4 divide-y divide-border border-t border-border">
      {session.submissions.map((submission) => <li key={submission.submissionId} className="min-w-0 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">{t(L, `Lần ${submission.attemptNo}`, `Attempt ${submission.attemptNo}`)}</p>
            <p className="mt-1 text-xs tabular-nums text-muted-foreground"><time dateTime={submission.submittedAt}>{new Date(submission.submittedAt).toLocaleString(L === 'vi' ? 'vi-VN' : 'en-GB')}</time></p>
          </div>
          <StatusTag status={submission.status} locale={L} />
        </div>
        {submission.payload.text ? <p className="mt-4 whitespace-pre-wrap break-words border-t border-border pt-3 text-sm leading-relaxed">{submission.payload.text}</p> : null}
        {submission.payload.links?.length ? <ul className="mt-3 space-y-1">{submission.payload.links.map((link, index) => <li key={`${link.url}-${index}`} className="min-w-0 break-all text-sm"><a className="text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" href={link.url} target="_blank" rel="noopener noreferrer">{link.label ?? link.url}</a></li>)}</ul> : null}
        {submission.payload.code?.code ? <pre className="mt-3 max-w-full overflow-x-auto border-l-2 border-border bg-muted p-3 text-xs"><code>{submission.payload.code.code}</code></pre> : null}
        {submission.files.length > 0 ? <ul className="mt-3 space-y-1">
          {submission.files.map((file) => <li key={file.assetId} className="min-w-0 break-all text-sm">
            <a className="text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" href={runtime.resolveMedia({ assetId: file.assetId })}>{file.name}</a>
            <span className="ml-2 text-xs tabular-nums text-muted-foreground">{Math.ceil(file.size / 1024)} KB</span>
          </li>)}
        </ul> : null}
        {submission.payload.notebook ? <p className="mt-3 text-sm"><a className="text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring" href={runtime.resolveMedia({ assetId: submission.payload.notebook.assetId })}>{t(L, 'Tệp notebook đã nộp', 'Submitted notebook file')}</a></p> : null}
        {submission.grade && submission.submissionId !== session.submissions[0]?.submissionId ? <div className="mt-4 border-t border-border pt-3 text-sm">
          <p className="font-medium tabular-nums">{t(L, `Điểm: ${submission.grade.totalPoints} trên ${submission.grade.maxPoints}`, `Score: ${submission.grade.totalPoints} of ${submission.grade.maxPoints}`)}</p>
          {localizedFeedback(submission.grade.feedback, L) ? <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{t(L, 'Phản hồi', 'Feedback')}: {localizedFeedback(submission.grade.feedback, L)}</p> : null}
        </div> : null}
      </li>)}
    </ol>
  </section>;
}

export function AssignmentRenderer({
  assignment,
  runtime,
  target = { blockId: null },
  hideTitle = false,
}: {
  assignment: LearnerItem | AssignmentBody;
  runtime: LessonRuntime;
  target?: AssignmentTarget;
  hideTitle?: boolean;
}) {
  const a = assignment as unknown as AssignmentBody & { rubric?: Rubric };
  const presentationId = target.blockId ?? a.id;
  const instanceId = useId();
  const instructionsId = `${instanceId}-instructions`;
  const submissionId = `${instanceId}-submission`;
  const rubricId = `${instanceId}-rubric`;
  const historyId = `${instanceId}-history`;
  const TitleTag = useSectionTag();
  const SubTag = useSectionTag(1);
  // Without its own title the page heading owns the item, so section headings take the title's slot.
  const SectionHeading = hideTitle ? 'h2' : SubTag;
  const stored = runtime.getBlockState<Stored>(presentationId);
  const initialSession = runtime.getAssignmentSession(target);
  const initialLatest = initialSession?.submissions[0];
  const [session, setSession] = useState(initialSession);
  const [payload, setPayload] = useState<AssignmentPayload>(() => (
    newerLocalDraft(stored, initialSession)
      ? stored!.payload
      : initialLatest ? submissionPayload(initialLatest) : stored?.payload ?? {}
  ));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<'submit' | 'stale' | null>(null);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const busyRef = useRef(false);
  const L = runtime.locale;
  const latest = session?.submissions[0];
  const action = session?.action;
  const locked = !action?.allowed;
  const notebookHref = a.notebook ? runtime.notebookHref?.(target) : undefined;
  const hasContent = Boolean(payload.text?.trim() || payload.links?.length || payload.files?.length || payload.code?.code?.trim());
  const status: AssignmentStatus = latest?.status ?? 'draft';

  const submit = async () => {
    if (busyRef.current || !action?.allowed) return;
    busyRef.current = true;
    setBusy(true);
    setSubmitError(null);
    setJustSubmitted(false);
    try {
      const result = await runtime.submitAssignment(target, payload, action.expectedLatestSubmissionId);
      const refreshed = result.session;
      const submitted = refreshed.submissions[0];
      setSession(refreshed);
      if (submitted) {
        const acceptedPayload = submissionPayload(submitted);
        setPayload(acceptedPayload);
        runtime.setBlockState(presentationId, {
          status: submitted.status,
          payload: acceptedPayload,
          submittedAt: submitted.submittedAt,
        });
        runtime.onActivityComplete(presentationId);
        setJustSubmitted(true);
      }
    } catch (error) {
      if (errorCode(error) === 'SUBMISSION_STALE') {
        try {
          setSession(await runtime.refreshAssignmentSession(target));
          setSubmitError('stale');
        } catch {
          setSubmitError('submit');
        }
      } else {
        setSubmitError('submit');
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="min-w-0 overflow-hidden rounded-[8px] border border-border bg-card text-card-foreground" aria-label={asText(a.title)}>
      <header className={`flex flex-wrap items-start gap-4 border-b border-border bg-muted/40 px-4 py-4 sm:px-6 sm:py-5 ${hideTitle ? 'justify-end' : 'justify-between'}`}>
        {/* With hideTitle the page head already carries the ASSIGNMENT kicker and the title. */}
        {!hideTitle ? <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t(L, 'Bài tập', 'Assignment')}</p>
          <TitleTag className="mt-1 break-words text-xl font-semibold leading-snug">{asText(a.title)}</TitleTag>
        </div> : null}
        <StatusTag status={status} locale={L} />
      </header>
      <div className="space-y-7 px-4 py-5 sm:px-6 sm:py-6">
        <section aria-labelledby={instructionsId}>
          <SectionHeading id={instructionsId} className="text-base font-semibold">{t(L, 'Hướng dẫn', 'Instructions')}</SectionHeading>
          <div className="mt-3 min-w-0 text-sm leading-relaxed text-foreground">{/* Inside the assignment card, so container blocks render flat (cards do not nest). */}<RichContentView content={asRich(a.instructions)} runtime={runtime} path={`/assignments/${a.id}/instructions`} depth={1} /></div>
        </section>

        {a.rubric ? <section aria-labelledby={rubricId} className="border-t border-border pt-6">
          <SectionHeading id={rubricId} className="text-base font-semibold">{t(L, 'Tiêu chí chấm', 'Grading criteria')}</SectionHeading>
          <p className="mt-1 text-sm text-muted-foreground">{t(L, 'Xem tiêu chí trước khi chuẩn bị bài nộp.', 'Use these criteria while preparing your work.')}</p>
          <AssignmentRubric rubric={a.rubric} locale={L} />
        </section> : null}

        {latest?.grade ? <ReleasedFeedback grade={latest.grade} status={latest.status} locale={L} headingAs={SectionHeading} /> : null}

        {a.notebook ? <section aria-labelledby={submissionId} className="border-t border-border pt-6">
          <SectionHeading id={submissionId} className="text-base font-semibold">{t(L, 'Không gian notebook', 'Notebook workspace')}</SectionHeading>
          <p className="mt-1 text-sm text-muted-foreground">{a.notebook.runtimeMode === 'colab_external' ? 'Google Colab' : 'Python / JupyterLite'}</p>
          {notebookHref
            ? <a href={notebookHref} className="mt-4 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t(L, 'Mở notebook', 'Open notebook')}</a>
            : <p className="mt-4 text-sm text-muted-foreground">{t(L, 'Notebook được mở trong không gian học sinh.', 'The notebook opens in the learner workspace.')}</p>}
        </section> : <section aria-labelledby={submissionId} className="border-t border-border pt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SectionHeading id={submissionId} className="text-base font-semibold">{t(L, 'Bài nộp của bạn', 'Your submission')}</SectionHeading>
            {action?.allowed ? <span className="text-xs font-medium text-muted-foreground">{action.kind === 'revision' ? t(L, 'Bản nháp chỉnh sửa', 'Revision draft') : t(L, 'Bản nháp', 'Draft')}</span> : null}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{action?.allowed
            ? action.kind === 'revision'
              ? t(L, `Xem phản hồi và chuẩn bị lần nộp ${action.nextAttemptNo}.`, `Review the feedback and prepare attempt ${action.nextAttemptNo}.`)
              : t(L, 'Thêm bài làm bên dưới, sau đó nộp khi bạn sẵn sàng.', 'Add your work below, then submit when you are ready.')
            : action ? {
                approved: t(L, 'Bài đã được duyệt.', 'This assignment is approved.'),
                awaiting_review: t(L, 'Bài đang chờ chấm.', 'This assignment is awaiting review.'),
                policy: t(L, 'Không thể nộp bản sửa theo chính sách của bài.', 'The assignment policy does not allow a revision.'),
                attempt_limit: t(L, 'Đã hết lượt nộp bài.', 'The submission attempt limit has been reached.'),
              }[action.reason] : null}</p>
          {!session ? <p className="mt-3 border-l-2 border-warning-border bg-warning px-4 py-3 text-sm text-warning-foreground">{t(L, 'Hiện chưa thể nộp bài. Hãy tải lại bài học để thử lại.', 'Submission is unavailable right now. Reload this item to try again.')}</p> : null}
          <div className={`mt-4 min-w-0 border-y border-border py-4 [&_input]:min-w-0 [&_input]:border-input [&_textarea]:border-input [&_input]:bg-card [&_textarea]:bg-card [&_textarea]:text-foreground [&_input]:text-foreground [&_ul]:min-w-0 [&_li]:min-w-0 [&_li]:break-words [&_a]:break-all ${locked ? 'opacity-70' : ''}`}>
            <SubmissionFields
              accepts={a.submission.accepts}
              value={payload}
              onChange={(value) => {
                setPayload(value);
                setSubmitError(null);
                setJustSubmitted(false);
                const current = runtime.getBlockState<Stored>(presentationId);
                runtime.setBlockState(presentationId, {
                  status: 'draft',
                  payload: value,
                  ...(current?.completed === true ? { completed: true } : {}),
                });
              }}
              disabled={locked || busy}
              runtime={runtime}
              assignmentTarget={target}
              maxFiles={a.submission.maxFiles}
              maxFileSizeMB={a.submission.maxFileSizeMB}
              allowedMimeTypes={a.submission.allowedMimeTypes}
              linkHosts={a.submission.linkHosts}
              codeLanguage={a.submission.codeLanguage}
              onUploadBusyChange={setUploading}
            />
          </div>
          {justSubmitted ? <p className="mt-4 border-l-2 border-success-border bg-success px-4 py-3 text-sm text-success-foreground" role="status">{t(L, 'Đã nộp bài. Bài làm của bạn đã sẵn sàng để chấm.', 'Assignment submitted. Your work is ready for review.')}</p> : null}
          {submitError ? <p className="mt-4 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">{submitError === 'stale'
            ? t(L, 'Lịch sử bài nộp mới nhất đã được tải. Hãy xem lại bản nháp trước khi nộp lại.', 'The latest submission history was loaded. Review your draft before submitting again.')
            : t(L, 'Không thể nộp bài. Hãy thử lại.', 'The assignment could not be submitted. Try again.')}</p> : null}
          <footer className="mt-4 flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center">
            <p className="text-xs leading-relaxed text-muted-foreground">{uploading
              ? t(L, 'Đợi tệp tải lên xong trước khi nộp.', 'Wait for files to finish uploading before submitting.')
              : action?.allowed && !hasContent
                ? t(L, 'Thêm ghi chú, liên kết, tệp hoặc mã nguồn để nộp.', 'Add notes, a link, a file, or code before submitting.')
                : action?.allowed
                  ? t(L, 'Kiểm tra bài làm trước khi nộp.', 'Review your work before submitting.')
                  : null}</p>
            <button type="button" onClick={() => void submit()} disabled={locked || busy || uploading || !hasContent} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50">
              {busy
                ? t(L, 'Đang nộp…', 'Submitting…')
                : action?.allowed && action.kind === 'revision'
                  ? t(L, 'Nộp bản sửa', 'Submit revision')
                  : t(L, 'Nộp bài', 'Submit assignment')}
            </button>
          </footer>
        </section>}

        {session && session.submissions.length > 0 ? <SubmissionHistory session={session} runtime={runtime} headingId={historyId} headingAs={SectionHeading} /> : null}
      </div>
    </section>
  );
}

export function AssignmentBlockRenderer({ block, runtime }: BlockRendererProps<AssignmentBlock>) {
  return <AssignmentRenderer assignment={block} target={{ blockId: block.id }} runtime={runtime} />;
}
