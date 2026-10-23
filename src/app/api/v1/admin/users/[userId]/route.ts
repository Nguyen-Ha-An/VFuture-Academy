import { withHandler, ok, parseBody } from '@/lib/api';
import { getLocale } from 'next-intl/server';
import { getAdminContext, assertRequestScope, assertSameOrigin, assertAdminPermission } from '@/features/admin/context';
import { actorDisplayNames } from '@/features/admin/actor-directory';
import { localizeOutlineTitle, versionTitles } from '@/features/grading/titles';
import { managementRead, managementWrite } from '@/features/admin/management';
import { MemberMutationSchema, routeParam } from '@/features/admin/management-schemas';
import type { MemberActor, MemberDetail, MemberSummary } from '@/features/admin/management-contracts';

/** Names for everyone the profile mentions (history actors, role grantors); never fails the read. */
async function withActors(detail: MemberDetail): Promise<MemberDetail> {
  const ids = [
    ...(detail.history ?? []).map((entry) => entry.actorId),
    ...(detail.assignments ?? []).map((assignment) => assignment.grantedBy),
  ];
  const names = await actorDisplayNames(ids);
  if (names.size === 0) return detail;
  const actors: Record<string, MemberActor> = {};
  for (const [id, actor] of names) actors[id] = { name: actor.name, initials: actor.initials, avatarUrl: actor.avatarUrl };
  return { ...detail, actors };
}

/** Published outline metadata names only the learning and results this scoped read permits. */
async function withLearningTitles(detail: MemberDetail): Promise<MemberDetail> {
  const learning = detail.actions?.readLearning ? (detail.learning ?? []) : [];
  const submissions = detail.actions?.readSubmissions ? (detail.submissions ?? []) : [];
  const exams = detail.actions?.readSubmissions ? (detail.examResults ?? []) : [];
  const versionIds = [...new Set([...learning, ...submissions, ...exams].map((item) => item.courseVersionId))];
  if (versionIds.length === 0) return detail;

  const [titles, requestedLocale] = await Promise.all([versionTitles(versionIds), getLocale()]);
  if (titles.size === 0) return detail;
  const locale = requestedLocale === 'en' ? 'en' : 'vi';
  const version = (id: string) => titles.get(id.toLowerCase());
  const readable = (title: string | null, id: string) => title && title !== id ? title : null;
  return {
    ...detail,
    ...(detail.actions.readLearning && detail.learning ? {
      learning: detail.learning.map((course) => {
        const title = readable(localizeOutlineTitle(version(course.courseVersionId)?.courseTitle, locale), course.courseId);
        return title ? { ...course, displayTitle: title } : course;
      }),
    } : {}),
    ...(detail.actions.readSubmissions && detail.submissions ? {
      submissions: detail.submissions.map((submission) => {
        const title = readable(localizeOutlineTitle(version(submission.courseVersionId)?.items.get(submission.itemId), locale), submission.itemId);
        return title ? { ...submission, displayTitle: title } : submission;
      }),
    } : {}),
    ...(detail.actions.readSubmissions && detail.examResults ? {
      examResults: detail.examResults.map((exam) => {
        const title = readable(localizeOutlineTitle(version(exam.courseVersionId)?.items.get(exam.itemId), locale), exam.itemId);
        return title ? { ...exam, displayTitle: title } : exam;
      }),
    } : {}),
  };
}

export const GET = withHandler(async (request, route) => {
  const context=await getAdminContext(); assertRequestScope(context,request);
  const detail=await managementRead<MemberDetail>(context,'user',{userId:await routeParam(route,'userId')});
  const [withNames, withTitles] = await Promise.all([withActors(detail), withLearningTitles(detail)]);
  return ok({ ...withNames, ...withTitles },{headers:{'Cache-Control':'private, no-store'}});
});
export const PATCH = withHandler(async (request,route) => {
  assertSameOrigin(request); const context=await getAdminContext(); assertRequestScope(context,request);
  const userId=await routeParam(route,'userId'); const {action,...input}=await parseBody(MemberMutationSchema,request);
  assertAdminPermission(context,'member.read');
  const updated=await managementWrite<MemberSummary>(context,`user.${action}`,{...input,userId});
  return ok(updated,{headers:{'Cache-Control':'private, no-store'}});
});
