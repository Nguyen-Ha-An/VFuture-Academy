import 'server-only';
import { ApiError } from '@/lib/api';
import { branchCanAccess } from '@/features/learning/shared';
import { supabaseService } from '@/lib/supabase/server';
import type { Actor } from '@/lib/permissions';
import { assignmentLocators, type ScheduleSchema, type AnnouncementCreateSchema, type AnnouncementUpdateSchema } from './contracts';
import type { z } from 'zod';
import { assignmentTitle, teachingTitle, type TeachingLocale } from './titles';

const database = () => supabaseService();
function failure(error: unknown): void { if (error) throw new ApiError(503, 'TEACHING_UNAVAILABLE', 'Teaching data is unavailable'); }
function missing(): never { throw new ApiError(404, 'TEACHING_NOT_FOUND', 'Course or teaching record not found for this school'); }

/** Current accessible versions and versions pinned to a school enrollment. */
export async function teachingOptions(branchId: string, locale: TeachingLocale = 'vi') {
  const db = database();
  const [courses, enrollments] = await Promise.all([
    db.from('courses').select('id,status,current_version_id,ownership_kind,owner_branch_id'),
    db.from('enrollments').select('course_id,course_version_id').eq('branch_id',branchId).eq('branch_scope_known',true).in('status',['active','completed']),
  ]);
  failure(courses.error); failure(enrollments.error);
  const eligibleCourses = (courses.data ?? []).filter(c => c.ownership_kind !== 'branch' || c.owner_branch_id === branchId);
  const ids = [...new Set([...eligibleCourses.flatMap(c => c.status === 'published' && c.current_version_id ? [c.current_version_id] : []), ...(enrollments.data ?? []).map(e=>e.course_version_id)])];
  if (!ids.length) return {courses:[],versions:[]};
  const [versions,outlines] = await Promise.all([
    db.from('course_versions').select('id,course_id,version').in('id',ids),
    db.from('course_version_outline').select('version_id,access,meta').in('version_id',ids),
  ]);
  failure(versions.error); failure(outlines.error);
  const rows = (versions.data ?? []).flatMap(version => {
    const course = eligibleCourses.find(c=>c.id===version.course_id);
    const outline = (outlines.data ?? []).find(o=>o.version_id===version.id);
    const pinned = (enrollments.data ?? []).some(e=>e.course_id===version.course_id && e.course_version_id===version.id);
    if (!course || !outline || !(pinned || course.status === 'published' && course.current_version_id === version.id && branchCanAccess(outline.access,branchId))) return [];
    const meta = outline.meta as {title?: string | {vi?:string;en?:string}} | null;
    const title = teachingTitle(meta?.title, locale, course.id);
    return [{courseId:course.id,courseTitle:title,courseVersionId:version.id,version:version.version}];
  });
  return {courses:[...new Map(rows.map(row=>[row.courseId,{id:row.courseId,title:row.courseTitle}])).values()],versions:rows};
}
async function assertCourseSchool(branchId: string, courseId: string) {
  const options=await teachingOptions(branchId);
  if (!options.courses.some(course=>course.id===courseId)) return missing();
}
async function versionCourse(branchId: string, versionId: string): Promise<string> {
  const options=await teachingOptions(branchId);
  const version=options.versions.find(row=>row.courseVersionId===versionId);
  if (!version) return missing();
  return version.courseId;
}
function announcement(row: Record<string, unknown>) {
  return { id:row.id, branchId:row.branch_id, courseId:row.course_id, title:row.title, body:row.body, status:row.status, publishedAt:row.published_at, createdAt:row.created_at, updatedAt:row.updated_at, revision:row.revision };
}
function schedule(row: Record<string, unknown>) {
  return { branchId:row.branch_id, courseVersionId:row.course_version_id, itemId:row.item_id, blockId:row.block_id, dueAt:row.due_at, updatedAt:row.updated_at };
}
export async function listAnnouncements(branchId:string, courseId:string) {
  await assertCourseSchool(branchId,courseId);
  const result = await database().from('teaching_announcements').select('*').eq('branch_id',branchId).eq('course_id',courseId).order('updated_at',{ascending:false});
  failure(result.error); return { announcements:(result.data ?? []).map(announcement) };
}
export async function createAnnouncement(actor:Actor, input:z.infer<typeof AnnouncementCreateSchema>) {
  await assertCourseSchool(input.branchId,input.courseId);
  const result = await database().from('teaching_announcements').insert({branch_id:input.branchId,course_id:input.courseId,title:input.title,body:input.body,created_by:actor.userId,updated_by:actor.userId}).select('*').single();
  failure(result.error); if (!result.data) return missing();
  return {announcement:announcement(result.data)};
}
export async function getAnnouncement(id:string) {
  const result = await database().from('teaching_announcements').select('*').eq('id',id).maybeSingle();
  failure(result.error); if (!result.data) return missing(); return result.data;
}
export async function changeAnnouncement(actor:Actor, id:string, branchId:string, action:'edit'|'publish'|'archive'|'delete', expectedRevision:number, input?:Omit<z.infer<typeof AnnouncementUpdateSchema>, 'expectedRevision'>) {
  const before = await getAnnouncement(id);
  if (before.branch_id !== branchId) return missing();
  if (before.revision !== expectedRevision) throw new ApiError(409,'STALE_ANNOUNCEMENT','Announcement changed');
  if (action === 'edit' || action === 'publish') await assertCourseSchool(branchId,before.course_id);
  if (action === 'edit' && before.status !== 'draft' || action === 'publish' && before.status !== 'draft' || action === 'archive' && before.status === 'archived' || action === 'delete' && before.status !== 'draft') throw new ApiError(409,'INVALID_ANNOUNCEMENT_STATE','This announcement cannot be changed in its current state');
  const db = database();
  if (action === 'delete') {
    const result = await db.rpc('delete_teaching_announcement',{p_id:id,p_actor_id:actor.userId,p_expected_revision:expectedRevision});
    failure(result.error); if (!result.data) throw new ApiError(409,'STALE_ANNOUNCEMENT','Announcement changed');
    return {deleted:true};
  }
  const update = action === 'edit' ? input : action === 'publish' ? {status:'published',published_at:new Date().toISOString()} : {status:'archived'};
  const result = await db.from('teaching_announcements').update({...update,updated_by:actor.userId,updated_at:new Date().toISOString()}).eq('id',id).eq('status',before.status).eq('revision',expectedRevision).select('*').maybeSingle();
  failure(result.error); if (!result.data) throw new ApiError(409,'STALE_ANNOUNCEMENT','Announcement changed');
  return {announcement:announcement(result.data)};
}
export async function listSchedules(branchId:string, versionId:string, locale: TeachingLocale = 'vi') {
  await versionCourse(branchId,versionId);
  const db=database();
  const [rows,items] = await Promise.all([
    db.from('assignment_schedules').select('*').eq('branch_id',branchId).eq('course_version_id',versionId),
    db.from('course_version_items').select('item_id,kind,grading,source').eq('version_id',versionId),
  ]);
  failure(rows.error); failure(items.error);
  const assignments=assignmentLocators(items.data ?? []).map(locator => {
    const source=(items.data ?? []).find(item=>item.item_id===locator.itemId)?.source;
    const title=assignmentTitle(source, locator.blockId, locale, locator.blockId ?? locator.itemId);
    return {...locator,title};
  });
  return {schedules:(rows.data ?? []).map(schedule),assignments};
}
export async function putSchedule(actor:Actor, input:z.infer<typeof ScheduleSchema>) {
  const existing = await listSchedules(input.branchId,input.courseVersionId);
  if (!existing.assignments.some(a=>a.itemId===input.itemId && a.blockId===input.blockId)) return missing();
  const result = await database().from('assignment_schedules').upsert({branch_id:input.branchId,course_version_id:input.courseVersionId,item_id:input.itemId,block_id:input.blockId,due_at:input.dueAt,updated_by:actor.userId,updated_at:new Date().toISOString()},{onConflict:'branch_id,course_version_id,item_id,block_id'}).select('*').single();
  failure(result.error); if (!result.data) return missing();
  return {schedule:schedule(result.data)};
}
