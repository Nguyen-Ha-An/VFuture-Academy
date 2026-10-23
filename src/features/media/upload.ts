import { ApiError } from '@/lib/api';
import {
  MAX_SUBMISSION_UPLOAD_MB,
  UPLOAD_EXTENSIONS_BY_MIME,
  isUploadMimeExtensionPair,
  uploadExtensionForFilename,
} from '@/content-engine/schema/uploads';

export const MEDIA_BUCKET = 'media';
export const SUBMISSIONS_BUCKET = 'submissions';
export const MAX_MEDIA_BYTES = MAX_SUBMISSION_UPLOAD_MB * 1024 * 1024;

type FileMetadata = { name: string; type: string; size: number };

/** Narrows an untrusted multipart entry to the browser File contract. */
export function isUploadedFile(value: unknown): value is File {
  return typeof value === 'object' && value !== null
    && typeof (value as File).name === 'string'
    && typeof (value as File).type === 'string'
    && typeof (value as File).size === 'number'
    && typeof (value as File).arrayBuffer === 'function';
}

/** Rejects invalid or oversized declared multipart bodies before parsing. */
export function assertUploadContentLength(request: Request): void {
  const rawLength = request.headers.get('content-length');
  if (rawLength === null) return;
  if (!/^(0|[1-9][0-9]*)$/.test(rawLength)) {
    throw new ApiError(400, 'INVALID_CONTENT_LENGTH', 'Content-Length header is invalid');
  }

  const contentLength = Number(rawLength);
  if (!Number.isSafeInteger(contentLength)) {
    throw new ApiError(400, 'INVALID_CONTENT_LENGTH', 'Content-Length header is invalid');
  }
  if (contentLength === 0) {
    throw new ApiError(400, 'EMPTY_UPLOAD', 'Upload body must not be empty');
  }
  if (contentLength > MAX_MEDIA_BYTES) {
    throw new ApiError(413, 'FILE_TOO_LARGE', 'Media file is too large');
  }
}

/**
 * Parses multipart data through a byte-counting reader, including chunked bodies.
 * The platform parser materializes each File, so the 50 MB ceiling also bounds
 * unavoidable parser memory while storage still receives the File/Blob directly.
 */
export async function parseUploadFormData(request: Request): Promise<FormData> {
  assertUploadContentLength(request);
  if (!request.body) {
    try {
      return await request.formData();
    } catch {
      throw new ApiError(400, 'INVALID_MULTIPART', 'Invalid upload request');
    }
  }

  const reader = request.body.getReader();
  let bytesRead = 0;
  let exceeded = false;
  const boundedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_MEDIA_BYTES) {
        exceeded = true;
        await reader.cancel('Upload body exceeded the byte limit');
        controller.error(new Error('Upload body exceeded the byte limit'));
        return;
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  const contentType = request.headers.get('content-type');
  try {
    return await new Response(boundedBody, {
      headers: contentType ? { 'content-type': contentType } : undefined,
    }).formData();
  } catch {
    if (exceeded) throw new ApiError(413, 'FILE_TOO_LARGE', 'Media file is too large');
    throw new ApiError(400, 'INVALID_MULTIPART', 'Invalid upload request');
  }
}

function basename(name: string): string {
  return name.replace(/\\/g, '/').split('/').pop() ?? '';
}

/** Infers one allow-listed MIME type from an imported asset filename. */
export function mediaMimeForFilename(name: string): string | null {
  const fileExtension = uploadExtensionForFilename(name);
  if (!fileExtension) return null;
  return Object.entries(UPLOAD_EXTENSIONS_BY_MIME)
    .find(([, extensions]) => extensions.includes(fileExtension))?.[0] ?? null;
}

/** Converts an untrusted display filename into a portable storage basename. */
export function safeMediaFilename(name: string): string {
  const source = basename(name);
  const extensionMatch = /\.([A-Za-z0-9]+)$/.exec(source);
  const suffix = extensionMatch?.[0] ?? '';
  const sourceStem = suffix ? source.slice(0, -suffix.length) : source;
  const safeStem = sourceStem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, Math.max(1, 120 - suffix.length));
  return `${safeStem || 'file'}${suffix}`;
}

/** Validates untrusted file metadata before storage is touched. */
export function mediaUploadMetadata(file: FileMetadata): { filename: string; extension: string } {
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_MEDIA_BYTES) {
    throw new ApiError(413, 'FILE_TOO_LARGE', 'Media file is too large');
  }

  const fileExtension = uploadExtensionForFilename(file.name);
  if (!fileExtension || !isUploadMimeExtensionPair(file.name, file.type)) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA', 'Unsupported media file');
  }

  const filename = safeMediaFilename(file.name);
  if (uploadExtensionForFilename(filename) !== fileExtension) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA', 'Unsupported media file');
  }

  return { filename, extension: fileExtension };
}

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeUlidTime(time: number): string {
  let value = time;
  let encoded = '';
  for (let index = 0; index < 10; index += 1) {
    encoded = ULID_ALPHABET[value % 32] + encoded;
    value = Math.floor(value / 32);
  }
  return encoded;
}

/** Generates a Crockford-base32 ULID without an additional runtime dependency. */
export function mediaAssetId(now = Date.now(), randomValues?: Uint8Array): string {
  const random = randomValues ?? crypto.getRandomValues(new Uint8Array(16));
  let encoded = encodeUlidTime(now);
  for (const value of random) encoded += ULID_ALPHABET[value % 32];
  return `asset_${encoded}`;
}
