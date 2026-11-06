import { z } from 'zod';
import { teachingOptions } from '@/features/teaching/service';
import { ApiError, withHandler } from '@/lib/api';
import { getActor, hasPermission } from '@/lib/permissions';
export const GET = withHandler(async request => {
  const params = new URL(request.url).searchParams;
  const branchId=z.string().min(1).max(100).parse(params.get('branchId'));
  const locale=z.enum(['vi','en']).default('vi').parse(params.get('locale') ?? undefined);
  const actor=await getActor();
  if (!actor) throw new ApiError(401,'UNAUTHENTICATED','Authentication required');
  if (!hasPermission(actor,'teaching.assignment.manage',{branchId}) && !hasPermission(actor,'teaching.schedule.manage',{branchId}) && !hasPermission(actor,'teaching.announcement.manage',{branchId})) throw new ApiError(403,'FORBIDDEN','Permission denied');
  return teachingOptions(actor, branchId, locale);
});
