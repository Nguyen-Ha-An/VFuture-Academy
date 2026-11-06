import { z } from 'zod';
import { ScheduleSchema } from '@/features/teaching/contracts';
import { listSchedules, putSchedule } from '@/features/teaching/service';
import { withHandler } from '@/lib/api';
import { readJsonBodyLimited } from '@/lib/body-limit';
import { requirePermission } from '@/lib/permissions';
const Query = z.object({branchId:z.string().min(1).max(100),courseVersionId:z.string().uuid(),locale:z.enum(['vi','en']).default('vi')});
export const GET = withHandler(async request => {
  const params=new URL(request.url).searchParams;
  const input=Query.parse({branchId:params.get('branchId'),courseVersionId:params.get('courseVersionId'),locale:params.get('locale') ?? undefined});
  const actor = await requirePermission('teaching.schedule.manage',{branchId:input.branchId});
  return listSchedules(actor,input.branchId,input.courseVersionId,input.locale);
});
export const PUT = withHandler(async request => {
  const input=ScheduleSchema.parse(await readJsonBodyLimited(request));
  const actor=await requirePermission('teaching.schedule.manage',{branchId:input.branchId});
  return putSchedule(actor,input);
});
