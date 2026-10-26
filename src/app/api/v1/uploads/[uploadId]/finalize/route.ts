import { finalizeDirectUpload, type DirectUploadDatabase } from '@/features/media/direct-upload';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseService } from '@/lib/supabase/server';

export const maxDuration = 300;
export const POST = withHandler(async (_request, context) => {
  const user = await requireApiUser();
  const { uploadId } = await (context as { params: Promise<{ uploadId: string }> }).params;
  return finalizeDirectUpload(user.id, uploadId, supabaseService() as unknown as DirectUploadDatabase);
});
