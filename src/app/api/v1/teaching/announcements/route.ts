import { z } from 'zod';
import { AnnouncementCreateSchema } from '@/features/teaching/contracts';
import { createAnnouncement, listAnnouncements } from '@/features/teaching/service';
import { withHandler } from '@/lib/api';
import { readJsonBodyLimited } from '@/lib/body-limit';
import { requirePermission } from '@/lib/permissions';
const Query = z.object({branchId:z.string().min(1).max(100),courseId:z.string().min(1).max(64)});
export const GET = withHandler(async request => {
  const params = new URL(request.url).searchParams;
  const input = Query.parse({branchId:params.get('branchId'),courseId:params.get('courseId')});
  const actor = await requirePermission('teaching.announcement.manage',{branchId:input.branchId});
  return listAnnouncements(actor,input.branchId,input.courseId);
});
export const POST = withHandler(async request => {
  const input = AnnouncementCreateSchema.parse(await readJsonBodyLimited(request));
  const actor = await requirePermission('teaching.announcement.manage',{branchId:input.branchId});
  return createAnnouncement(actor,input);
});
