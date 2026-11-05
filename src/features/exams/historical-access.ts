import 'server-only';
import { assertEnrollmentMembershipAccess, type MembershipAccessDatabase } from '@/features/learning/membership-access';
import { ApiError } from '@/lib/api';
import type { ExamActor, ExamAttemptRecord } from './types';

type Result={data:unknown;error:unknown|null};
export interface HistoricalReviewQuery {
  select(columns:string):this;
  eq(column:string,value:unknown):this;
  in(column:string,values:string[]):this;
  maybeSingle():PromiseLike<Result>;
}
export interface HistoricalReviewDatabase { from(table:string):HistoricalReviewQuery }
const record=(value:unknown):Record<string,unknown>|null => typeof value==='object' && value!==null && !Array.isArray(value) ? value as Record<string,unknown> : null;

/** Never substitutes the learner's present school for the immutable attempt school. */
export function createHistoricalExamReviewAuthorizer(database:HistoricalReviewDatabase) {
  return async (actor:ExamActor, attempt:Pick<ExamAttemptRecord,'userId'|'courseVersionId'|'branchId'>, courseId:string):Promise<boolean> => {
    if (attempt.userId!==actor.id) return false;
    const version=await database.from('course_versions').select('course_id').eq('id',attempt.courseVersionId).maybeSingle();
    if(version.error) throw new ApiError(503,'EXAM_REVIEW_UNAVAILABLE','Historical course access could not be verified');
    if(record(version.data)?.course_id!==courseId) return false;
    const enrollment=await database.from('enrollments').select('course_version_id').eq('user_id',actor.id).eq('course_id',courseId).in('status',['active','completed']).maybeSingle();
    if(enrollment.error) throw new ApiError(503,'EXAM_REVIEW_UNAVAILABLE','Course enrollment could not be verified');
    if(typeof record(enrollment.data)?.course_version_id!=='string') return false;
    await assertEnrollmentMembershipAccess({userId:actor.id,roles:[]},
      {branch_scope_known:attempt.branchId!==null,branch_id:attempt.branchId},database as unknown as MembershipAccessDatabase);
    return true;
  };
}
