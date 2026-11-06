import { z } from 'zod';
import { withHandler } from '@/lib/api';
import { requirePermission } from '@/lib/permissions';
import { teacherOptions } from '@/features/teaching/assignments';
import { TeachingBranchId } from '@/features/teaching/assignment-contracts';
export const GET = withHandler(async request => {
  const params = new URL(request.url).searchParams;
  const branchId = TeachingBranchId.parse(params.get('branchId'));
  const page = z.coerce.number().int().min(1).max(1_000_000).default(1).parse(params.get('page') ?? undefined);
  const pageSize = z.coerce.number().int().min(1).max(100).default(100).parse(params.get('pageSize') ?? undefined);
  const actor = await requirePermission('teaching.assignment.manage', { branchId });
  return teacherOptions(actor, branchId, page, pageSize);
});
