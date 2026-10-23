/** Uploaded project cover as returned by `POST /api/v1/uploads` with `purpose=project_cover`. */
export type UploadedCover = { assetId: string; url: string; name: string; size: number; mime: string };

export const PROJECT_COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export class CoverUploadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CoverUploadError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sends one cover image with upload progress (XHR, as in the assignment
 * runtime's `uploadWithProgress`). Aborting the signal rejects with
 * `UPLOAD_CANCELLED`.
 */
export function uploadProjectCover(
  file: File,
  options: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {},
): Promise<UploadedCover> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new CoverUploadError('UPLOAD_CANCELLED', 'Upload cancelled'));
      return;
    }
    const form = new FormData();
    form.append('file', file);
    form.append('purpose', 'project_cover');
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    xhr.open('POST', '/api/v1/uploads');
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', (event) => {
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      options.onProgress?.(total > 0 ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0);
    });
    xhr.addEventListener('load', () => {
      cleanup();
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = isRecord(body) && isRecord(body.error) ? body.error : null;
        reject(new CoverUploadError(
          typeof error?.code === 'string' ? error.code : 'UPLOAD_FAILED',
          typeof error?.message === 'string' ? error.message : 'Upload failed',
        ));
        return;
      }
      const data = isRecord(body) && isRecord(body.data) ? body.data : null;
      if (!data || typeof data.assetId !== 'string') {
        reject(new CoverUploadError('INVALID_RESPONSE', 'Upload response did not contain an asset'));
        return;
      }
      options.onProgress?.(100);
      resolve(data as unknown as UploadedCover);
    });
    xhr.addEventListener('error', () => {
      cleanup();
      reject(new CoverUploadError('NETWORK_ERROR', 'Upload failed'));
    });
    xhr.addEventListener('abort', () => {
      cleanup();
      reject(new CoverUploadError('UPLOAD_CANCELLED', 'Upload cancelled'));
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    xhr.send(form);
  });
}
