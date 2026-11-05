import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { IdSchema } from '@/content-engine/schema/common';
import { AttemptIdSchema } from '@/features/exams/http';
import { createServerExamService, learnerExamActor } from '@/features/exams/server';
import { ExamError } from '@/features/exams/types';
import { HistoricalExamReview } from '@/features/exams/ui/HistoricalExamReview';
import { requireUser } from '@/lib/auth';
import { routes } from '@/lib/routes';

export default async function HistoricalExamReviewPage({params}:{params:Promise<{courseId:string;itemId:string;attemptId:string}>}) {
  const [raw,user,language]=await Promise.all([params,requireUser(),getLocale()]);
  const course=IdSchema.safeParse(raw.courseId),item=IdSchema.safeParse(raw.itemId),attempt=AttemptIdSchema.safeParse(raw.attemptId);
  if(!course.success || !item.success || !attempt.success) notFound();
  const actor=await learnerExamActor(user.id);
  let result;
  try { result=await createServerExamService().historicalReview(actor,attempt.data,course.data,item.data); }
  catch(error) {
    if(error instanceof ExamError && (error.code==='FORBIDDEN' || error.code==='ATTEMPT_NOT_ACTIVE')) notFound();
    throw error;
  }
  const locale=language==='en'?'en':'vi';
  return <section className="mx-auto max-w-5xl space-y-5 p-4 md:p-8">
    <Link href={routes.learner.results()}>{locale==='vi'?'Quay lại kết quả':'Back to results'}</Link>
    <h1 tabIndex={-1} className="text-2xl font-semibold">{result.learner.title}</h1>
    <HistoricalExamReview learner={result.learner} review={result.review} locale={locale} context={{attemptId:attempt.data,courseId:course.data,itemId:item.data}}/>
  </section>;
}
