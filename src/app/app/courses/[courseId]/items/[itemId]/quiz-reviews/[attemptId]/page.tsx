import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { IdSchema } from '@/content-engine';
import { answerLabels, historyText, RecordedAnswer, recordedTime } from '@/features/coursework/history-view';
import { recordsOf } from '@/features/learning/shared';
import { getQuizHistoricalReview } from '@/features/quizzes/history';
import { ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { routes } from '@/lib/routes';

export default async function HistoricalQuizPage({ params }: { params: Promise<{ courseId: string; itemId: string; attemptId: string }> }) {
  const [raw, user, language] = await Promise.all([params, requireUser(), getLocale()]);
  const locator = z.object({ courseId: IdSchema, itemId: IdSchema, attemptId: z.uuid() }).safeParse(raw);
  if (!locator.success) notFound();
  const locale = language === 'en' ? 'en' : 'vi';
  let result;
  try { result = await getQuizHistoricalReview({ userId: user.id, roles: [] }, locator.data, locale); }
  catch (error) { if (error instanceof ApiError && error.status === 404) notFound(); throw error; }
  const { attempt } = result;
  return <section id={result.blockId} className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
    <Link className="underline" href={routes.learner.results()}>{locale === 'vi' ? 'Quay lại kết quả' : 'Back to results'}</Link>
    <header className="space-y-2"><p>{result.courseTitle}</p><h1 tabIndex={-1} className="text-2xl font-semibold">{historyText(result.quiz.title, locale)}</h1>
      <p>{locale === 'vi' ? `Lần làm ${attempt.attemptNo}` : `Attempt ${attempt.attemptNo}`} · <time dateTime={attempt.submittedAt}>{recordedTime(attempt.submittedAt, locale)} ICT</time></p>
      <p className="text-xl font-semibold">{attempt.points} / {attempt.maxPoints} · {attempt.percent}%</p>
    </header>
    <ol className="space-y-6">{recordsOf(result.quiz.questions).map((question, index) => {
      const id = typeof question.id === 'string' ? question.id : '';
      const labels = answerLabels(question, locale);
      const saved = attempt.results.find((entry) => entry.questionId === id);
      return <li key={id || index} className="space-y-3 border-t border-border pt-5">
        <h2 className="text-lg font-semibold">{locale === 'vi' ? `Câu ${index + 1}` : `Question ${index + 1}`}</h2>
        <p className="whitespace-pre-wrap">{historyText(question.stem ?? question.prompt ?? question.sharedContent, locale)}</p>
        {recordsOf(question.options).length > 0 && <ul className="list-inside list-disc">{recordsOf(question.options).map((option, optionIndex) => <li key={String(option.id ?? optionIndex)}>{historyText(option.content, locale)}</li>)}</ul>}
        <h3 className="font-medium">{locale === 'vi' ? 'Câu trả lời đã lưu' : 'Saved answer'}</h3>
        <RecordedAnswer value={attempt.answers[id]} locale={locale} labels={labels} />
        {saved && <p>{locale === 'vi' ? 'Điểm đã ghi nhận' : 'Recorded points'}: {saved.points} / {saved.maxPoints}</p>}
      </li>;
    })}</ol>
  </section>;
}
