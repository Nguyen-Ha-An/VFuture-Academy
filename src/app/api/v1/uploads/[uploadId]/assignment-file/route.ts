import { cancelAssignmentFile, transferAssignmentFile } from '@/features/media/assignment-files';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseService } from '@/lib/supabase/server';

type Context = { params: Promise<{ uploadId: string }> };

export const PUT = withHandler(async (request, context) => {
  const user = await requireApiUser();
  const { uploadId } = await (context as Context).params;
  return transferAssignmentFile(supabaseService(), user.id, uploadId, request);
});

export const DELETE = withHandler(async (_request, context) => {
  const user = await requireApiUser();
  const { uploadId } = await (context as Context).params;
  return cancelAssignmentFile(supabaseService(), user.id, uploadId);
});
