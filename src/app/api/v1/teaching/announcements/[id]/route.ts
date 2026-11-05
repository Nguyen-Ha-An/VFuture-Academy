import { z } from 'zod';
import { AnnouncementRevisionSchema, AnnouncementUpdateSchema } from '@/features/teaching/contracts';
import { changeAnnouncement, getAnnouncement } from '@/features/teaching/service';
import { withHandler } from '@/lib/api';
import { readJsonBodyLimited } from '@/lib/body-limit';
import { requireApiUser } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
async function contextId(context:unknown) { return z.string().uuid().parse((await (context as {params:Promise<{id:string}>}).params).id); }
export const PATCH = withHandler(async (request,context) => {
  await requireApiUser(); const id=await contextId(context); const row=await getAnnouncement(id);
  const actor=await requirePermission('teaching.announcement.manage',{branchId:row.branch_id});
  const { expectedRevision, ...input } = AnnouncementUpdateSchema.parse(await readJsonBodyLimited(request));
  return changeAnnouncement(actor,id,row.branch_id,'edit',expectedRevision,input);
});
export const DELETE = withHandler(async (request,context) => {
  await requireApiUser(); const id=await contextId(context); const row=await getAnnouncement(id);
  const actor=await requirePermission('teaching.announcement.manage',{branchId:row.branch_id});
  const { expectedRevision } = AnnouncementRevisionSchema.parse(await readJsonBodyLimited(request));
  return changeAnnouncement(actor,id,row.branch_id,'delete',expectedRevision);
});
