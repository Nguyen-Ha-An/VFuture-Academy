import { z } from 'zod';
import { AnnouncementRevisionSchema } from '@/features/teaching/contracts';
import { readJsonBodyLimited } from '@/lib/body-limit';
import { changeAnnouncement, getAnnouncement } from '@/features/teaching/service';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { requirePermission } from '@/lib/permissions';
export const POST = withHandler(async (request,context) => {
  await requireApiUser();
  const id=z.string().uuid().parse((await (context as {params:Promise<{id:string}>}).params).id);
  const row=await getAnnouncement(id);
  const actor=await requirePermission('teaching.announcement.manage',{branchId:row.branch_id});
  const { expectedRevision } = AnnouncementRevisionSchema.parse(await readJsonBodyLimited(request));
  return changeAnnouncement(actor,id,row.branch_id,'publish',expectedRevision);
});
