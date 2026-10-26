import { cancelDirectUpload, type DirectUploadDatabase } from '@/features/media/direct-upload';
import { withHandler } from '@/lib/api';
import { requireApiUser } from '@/lib/auth';
import { supabaseService } from '@/lib/supabase/server';

export const DELETE = withHandler(async (_request, context) => {
  const user = await requireApiUser();
  const { uploadId } = await (context as { params: Promise<{ uploadId: string }> }).params;
  return cancelDirectUpload(user.id, uploadId, supabaseService() as unknown as DirectUploadDatabase);
});
