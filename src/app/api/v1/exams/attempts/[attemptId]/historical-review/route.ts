import { z } from 'zod';
import { IdSchema } from '@/content-engine/schema/common';
import { AttemptIdSchema, examOperation, streamExamJson } from '@/features/exams/http';
import { createServerExamService, learnerExamActor } from '@/features/exams/server';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';

const querySchema=z.object({courseId:IdSchema,itemId:IdSchema}).strict();
export const GET=withHandler(async(request,context)=>{
  const user=await requireApiUser();
  const {attemptId}=await (context as {params:Promise<{attemptId:string}>}).params;
  const params=new URL(request.url).searchParams;
  const query=querySchema.parse({courseId:params.get('courseId'),itemId:params.get('itemId')});
  const actor=await learnerExamActor(user.id);
  return streamExamJson(await examOperation(()=>createServerExamService().historicalReview(actor,AttemptIdSchema.parse(attemptId),query.courseId,query.itemId)));
});
