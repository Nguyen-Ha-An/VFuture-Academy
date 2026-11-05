import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { IdSchema } from '@/content-engine';
import { historyText, RecordedAnswer, recordedTime } from '@/features/coursework/history-view';
import { getAssignmentHistoricalReview } from '@/features/submissions/history';
import { ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { routes } from '@/lib/routes';

export default async function HistoricalAssignmentPage({ params }: { params: Promise<{ courseId: string; itemId: string; submissionId: string }> }) {
  const [raw, user, language] = await Promise.all([params, requireUser(), getLocale()]);
  const locator = z.object({ courseId: IdSchema, itemId: IdSchema, submissionId: z.uuid() }).safeParse(raw);
  if (!locator.success) notFound();
  const locale = language === 'en' ? 'en' : 'vi';
  let result;
  try { result = await getAssignmentHistoricalReview({ userId: user.id, roles: [] }, locator.data, locale); }
  catch (error) { if (error instanceof ApiError && error.status === 404) notFound(); throw error; }
  const { submission } = result;
  const status = { submitted: locale === 'vi' ? 'Đã nộp' : 'Submitted', in_review: locale === 'vi' ? 'Đang chấm' : 'In review',
    approved: locale === 'vi' ? 'Đã duyệt' : 'Approved', changes_requested: locale === 'vi' ? 'Cần chỉnh sửa' : 'Changes requested' }[submission.status];
  return <section id={result.blockId ?? undefined} className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
    <Link className="underline" href={routes.learner.results()}>{locale === 'vi' ? 'Quay lại kết quả' : 'Back to results'}</Link>
    <header className="space-y-2"><p>{result.courseTitle}</p><h1 tabIndex={-1} className="text-2xl font-semibold">{historyText(result.assignment.title, locale)}</h1>
      <p>{locale === 'vi' ? `Lần nộp ${submission.attemptNo}` : `Submission ${submission.attemptNo}`} · {status}</p>
      <p><time dateTime={submission.submittedAt}>{recordedTime(submission.submittedAt, locale)} ICT</time></p>
    </header>
    {historyText(result.assignment.instructions, locale) && <p className="whitespace-pre-wrap">{historyText(result.assignment.instructions, locale)}</p>}
    <section className="space-y-3 border-y border-border py-5" aria-labelledby="saved-submission"><h2 id="saved-submission" className="text-lg font-semibold">{locale === 'vi' ? 'Bài đã nộp' : 'Submitted work'}</h2>
      {submission.payload.text && <p className="whitespace-pre-wrap break-words">{submission.payload.text}</p>}
      {submission.payload.links?.map((link, index) => <p key={index}><RecordedAnswer value={link} locale={locale} /></p>)}
      {submission.payload.code && <RecordedAnswer value={submission.payload.code} locale={locale} />}
      {submission.files.map((file) => <p key={file.assetId}><RecordedAnswer value={file} locale={locale} /></p>)}
      {submission.payload.notebook && <p><RecordedAnswer value={submission.payload.notebook} locale={locale} /></p>}
      {submission.late === true && <p>{locale === 'vi' ? 'Nộp muộn (ghi nhận khi nộp bài).' : 'Submitted late (recorded at submission).'}</p>}
      {submission.dueAtSnapshot && <p>{locale === 'vi' ? 'Hạn nộp khi nộp bài' : 'Due date at submission'}: <time dateTime={submission.dueAtSnapshot}>{recordedTime(submission.dueAtSnapshot, locale)} ICT</time></p>}
    </section>
    {submission.grade ? <section className="space-y-3" aria-labelledby="released-feedback"><h2 id="released-feedback" className="text-lg font-semibold">{locale === 'vi' ? 'Kết quả đã công bố' : 'Released result'}</h2>
      <p className="font-semibold">{submission.grade.totalPoints} / {submission.grade.maxPoints}</p>
      <p className="whitespace-pre-wrap">{historyText(submission.grade.feedback, locale)}</p>
    </section> : <p>{locale === 'vi' ? 'Chưa có kết quả được công bố cho lần nộp này.' : 'No released result is available for this submission.'}</p>}
  </section>;
}
