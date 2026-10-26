import { directUploadFile, DirectUploadError } from '@/features/media/direct-upload-client';

/** Finalized project cover in the existing media-asset response shape. */
export type UploadedCover = { assetId: string; url: string; name: string; size: number; mime: string };
export const PROJECT_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export class CoverUploadError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CoverUploadError'; }
}

export async function uploadProjectCover(
  file: File,
  options: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {},
): Promise<UploadedCover> {
  try {
    const uploaded = await directUploadFile(file, { purpose: 'project_cover' }, {
      signal: options.signal,
      onProgress: (progress) => options.onProgress?.(progress.percent),
    });
    if (typeof uploaded.url !== 'string') throw new CoverUploadError('INVALID_RESPONSE', 'Upload response did not contain a cover');
    return uploaded as UploadedCover;
  } catch (error) {
    if (error instanceof DirectUploadError) throw new CoverUploadError(error.code, error.message);
    throw error;
  }
}
