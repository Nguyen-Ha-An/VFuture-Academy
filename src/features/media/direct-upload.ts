import 'server-only';

import { createHash } from 'node:crypto';
import { imageSize } from 'image-size';
import JSZip from 'jszip';
import { z } from 'zod';
import { IdSchema } from '@/content-engine/schema/common';
import { authorizeAssignmentUpload } from '@/features/submissions/service';
import { grantStorageTransferUrl } from '@/features/storage-transfer/grants';
import { mediaAssetId, mediaUploadMetadata, MAX_MEDIA_BYTES } from '@/features/media/upload';
import { mediaHref } from '@/features/media/urls';
import { ApiError } from '@/lib/api';

const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const RequestSchema = z.object({
  uploadId: z.string().uuid(), name: z.string().min(1).max(512),
  size: z.number().int().positive().max(MAX_MEDIA_BYTES), mime: z.string().min(1).max(150),
  checksum: z.string().regex(/^[a-f0-9]{64}$/),
  purpose: z.enum(['avatar', 'project_cover', 'submission']),
  courseId: IdSchema.optional(), itemId: IdSchema.optional(), blockId: IdSchema.nullable().optional(),
}).strict();
export type DirectUploadInput = z.infer<typeof RequestSchema>;
export type UploadReservation = {
  id: string; owner_id: string; asset_id: string; filename: string; size_bytes: number; checksum: string;
  mime: string; purpose: DirectUploadInput['purpose']; bucket: string; pending_path: string; ready_path: string;
  request: Omit<DirectUploadInput, 'uploadId'>; state: 'reserved' | 'finalizing' | 'ready' | 'cancelled' | 'cleaning';
  expires_at: string; retain_until: string; lease_token: string | null; released_at: string | null;
};
type DbError = { message?: string; statusCode?: number | string } | null;
export type DirectUploadDatabase = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>;
  storage: { from(bucket: string): {
    createSignedUploadUrl(path: string, options: { upsert: false }): PromiseLike<{ data: { signedUrl: string } | null; error: DbError }>;
    download(path: string): { asStream(): PromiseLike<{ data: ReadableStream<Uint8Array> | null; error: DbError }> };
    upload(path: string, body: Uint8Array, options: { contentType: string; upsert: false }): PromiseLike<{ error: DbError }>;
    remove(paths: string[]): PromiseLike<{ error: DbError }>;
  } };
};

export function parseDirectUploadInput(value: unknown): DirectUploadInput {
  const input = RequestSchema.parse(value);
  const { filename } = mediaUploadMetadata({ name: input.name, size: input.size, type: input.mime });
  if (input.purpose === 'submission') {
    if (!input.courseId || !input.itemId) throw new ApiError(400, 'INVALID_UPLOAD_CONTEXT', 'Assignment context is required');
  } else {
    if (!imageTypes.includes(input.mime)) throw new ApiError(415, input.purpose === 'avatar' ? 'UNSUPPORTED_AVATAR' : 'UNSUPPORTED_PROJECT_COVER', 'Choose a JPEG, PNG, or WebP image');
    if (input.courseId || input.itemId || input.blockId) throw new ApiError(400, 'INVALID_UPLOAD_CONTEXT', 'Image context is invalid');
  }
  return { ...input, name: filename, ...(input.purpose === 'submission' ? { blockId: input.blockId ?? null } : {}) };
}
async function authorize(owner: string, input: Omit<DirectUploadInput, 'uploadId'>) {
  if (input.purpose === 'submission') await authorizeAssignmentUpload(
    { userId: owner, roles: [] },
    { courseId: input.courseId!, itemId: input.itemId!, blockId: input.blockId ?? null },
    { size: input.size, mime: input.mime },
  );
}
function rpcError(error: DbError): never {
  const code = ['UPLOAD_NOT_FOUND', 'UPLOAD_CONFLICT', 'UPLOAD_ACTIVE', 'UPLOAD_CAPACITY', 'UPLOAD_BUSY', 'UPLOAD_EXPIRED', 'UPLOAD_FINALIZED', 'UPLOAD_BYTES_REMAIN'].find((key) => error?.message?.includes(key));
  if (code) throw new ApiError(code === 'UPLOAD_NOT_FOUND' ? 404 : code === 'UPLOAD_CAPACITY' ? 507 : 409, code, {
    UPLOAD_NOT_FOUND: 'Upload not found', UPLOAD_CONFLICT: 'Upload details changed', UPLOAD_ACTIVE: 'Finish or cancel the active upload first',
    UPLOAD_CAPACITY: 'Upload storage is full', UPLOAD_BUSY: 'Upload is being processed; retry shortly', UPLOAD_EXPIRED: 'Upload expired',
    UPLOAD_FINALIZED: 'Upload is already saved', UPLOAD_BYTES_REMAIN: 'Upload cleanup is incomplete',
  }[code]!);
  throw new ApiError(503, 'UPLOAD_UNAVAILABLE', 'Uploads are temporarily unavailable');
}
async function transition(database: DirectUploadDatabase, owner: string, id: string, action: string, lease: string | null = null, extra = {}) {
  const { data, error } = await database.rpc('media_upload_transition', { p_owner: owner, p_id: id, p_action: action, p_lease: lease, p_extra: extra });
  if (error || !data) rpcError(error);
  return data as UploadReservation;
}
function response(r: UploadReservation) {
  return { assetId: r.asset_id, name: r.filename, size: Number(r.size_bytes), mime: r.mime,
    ...(r.purpose === 'submission' ? {} : { url: mediaHref(r.asset_id) }) };
}

/** A repeated uploadId refreshes a permit only for the same validated reservation. */
export async function reserveDirectUpload(owner: string, value: unknown, database: DirectUploadDatabase) {
  const { uploadId, ...input } = parseDirectUploadInput(value);
  await authorize(owner, input);
  const { data, error } = await database.rpc('media_upload_reserve', { p_owner: owner, p_id: uploadId, p_asset: mediaAssetId(), p_request: input });
  if (error || !data) rpcError(error);
  const row = data as UploadReservation;
  if (row.state === 'ready') return { uploadId, file: response(row) };
  const signed = await database.storage.from(row.bucket).createSignedUploadUrl(row.pending_path, { upsert: false });
  if (signed.error || !signed.data) throw new ApiError(503, 'UPLOAD_UNAVAILABLE', 'Upload signing is unavailable');
  // The Storage response is trusted, but its configured token TTL can drift.
  // Reading exp is only a retention calculation, never an authorization check.
  let tokenExpiry: number;
  try {
    const token = new URL(signed.data.signedUrl).searchParams.get('token');
    const claims = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString('utf8'));
    tokenExpiry = claims.exp;
    if (!Number.isSafeInteger(tokenExpiry) || tokenExpiry * 1000 <= Date.now()) throw new Error('Invalid expiry');
  } catch { throw new ApiError(503, 'UPLOAD_UNAVAILABLE', 'Upload signing returned an invalid expiry'); }
  await transition(database, owner, uploadId, 'signed', null, { expiresAt: new Date(tokenExpiry * 1000).toISOString() });
  // Signing may have waited on the network; never issue a permit past the
  // reservation deadline. SQL quarantine covers issuance up to this deadline.
  const seconds = Math.min(900, Math.floor((Date.parse(row.expires_at) - Date.now()) / 1000));
  if (seconds < 1) throw new ApiError(409, 'UPLOAD_EXPIRED', 'Upload expired');
  const uploadUrl = grantStorageTransferUrl(signed.data.signedUrl, {
    subject: owner, method: 'PUT', bucket: row.bucket, path: row.pending_path, maxBytes: Number(row.size_bytes), expiresIn: seconds,
  });
  return { uploadId, uploadUrl, method: 'PUT' as const, expiresAt: row.expires_at };
}

const unsupported = () => new ApiError(415, 'UNSUPPORTED_MEDIA', 'File bytes do not match the declared media type');
/** Checks complete bytes and signatures; neither browser declarations nor Storage metadata are proof. */
export async function verifyUploadBytes(r: UploadReservation, bytes: Uint8Array) {
  if (bytes.byteLength !== Number(r.size_bytes) || bytes.byteLength < 1 || bytes.byteLength > MAX_MEDIA_BYTES) throw new ApiError(400, 'UPLOAD_SIZE_MISMATCH', 'Uploaded size does not match the reservation');
  if (createHash('sha256').update(bytes).digest('hex') !== r.checksum) throw new ApiError(400, 'CHECKSUM_MISMATCH', 'Uploaded checksum does not match');
  mediaUploadMetadata({ name: r.filename, size: bytes.byteLength, type: r.mime });
  const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  const ascii = (start: number, end: number) => Buffer.from(bytes.subarray(start, end)).toString('latin1');
  const iso = ascii(4, 8) === 'ftyp';
  const zip = starts(0x50, 0x4b, 3, 4) || starts(0x50, 0x4b, 5, 6);
  const signatures: Record<string, boolean> = {
    'image/jpeg': starts(0xff, 0xd8, 0xff), 'image/png': starts(137, 80, 78, 71, 13, 10, 26, 10),
    'image/webp': ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
    'image/gif': ['GIF87a', 'GIF89a'].includes(ascii(0, 6)), 'image/bmp': ascii(0, 2) === 'BM',
    'image/tiff': starts(0x49, 0x49, 42, 0) || starts(0x4d, 0x4d, 0, 42), 'image/x-icon': starts(0, 0, 1, 0),
    'image/avif': iso && /avif|avis/.test(ascii(8, 64)), 'image/heic': iso && /heic|heix|hevc|hevx/.test(ascii(8, 64)),
    'image/heif': iso && /mif1|msf1|heic|heix/.test(ascii(8, 64)),
    'image/jxl': starts(0xff, 0x0a) || starts(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 13, 10, 0x87, 10),
    'application/pdf': ascii(0, 5) === '%PDF-', 'application/zip': zip,
    'video/mp4': iso, 'audio/mp4': iso, 'audio/mpeg': ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
  };
  if (r.mime in signatures && !signatures[r.mime]) throw unsupported();
  if (['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'].includes(r.mime)
    && !starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) throw unsupported();
  const zipDocuments: Record<string, string> = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word/document.xml',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xl/workbook.xml',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'ppt/presentation.xml',
    'application/vnd.oasis.opendocument.text': 'content.xml', 'application/vnd.oasis.opendocument.spreadsheet': 'content.xml',
    'application/vnd.oasis.opendocument.presentation': 'content.xml',
  };
  if (r.mime in zipDocuments) {
    if (!zip) throw unsupported();
    try { if (!(await JSZip.loadAsync(bytes)).file(zipDocuments[r.mime])) throw unsupported(); }
    catch { throw unsupported(); }
  }
  if (['text/plain', 'text/csv', 'application/json', 'application/x-ipynb+json'].includes(r.mime)) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (text.includes('\0')) throw unsupported();
      if (r.mime.includes('json')) {
        const value = JSON.parse(text);
        if (r.mime === 'application/x-ipynb+json' && (!value || !Array.isArray(value.cells) || !Number.isInteger(value.nbformat))) throw unsupported();
      }
    } catch { throw unsupported(); }
  }
  let width: number | null = null, height: number | null = null;
  if (r.mime.startsWith('image/')) {
    try {
      const dimensions = imageSize(bytes.subarray(0, 64 * 1024));
      width = dimensions.width ?? null; height = dimensions.height ?? null;
    } catch {
      // General media preserves the existing optional metadata behavior. Profile
      // images need dimensions; large EXIF segments may put their frame header
      // beyond 64 KiB, so use the already bounded, verified file as a fallback.
      if (r.purpose === 'avatar' || r.purpose === 'project_cover') {
        try { const dimensions = imageSize(bytes); width = dimensions.width ?? null; height = dimensions.height ?? null; }
        catch { throw unsupported(); }
      }
    }
    if (width !== null && height !== null && (width < 1 || height < 1 || width * height > 100_000_000)) throw unsupported();
    if ((r.purpose === 'avatar' || r.purpose === 'project_cover') && (width === null || height === null)) throw unsupported();
  }
  return { width, height };
}
async function downloadedBytes(database: DirectUploadDatabase, r: UploadReservation, path: string) {
  const { data, error } = await database.storage.from(r.bucket).download(path).asStream();
  if (error || !data) {
    if (String(error?.statusCode) === '404') throw new ApiError(404, 'UPLOAD_NOT_FOUND', 'Upload has not reached storage');
    throw new ApiError(503, 'UPLOAD_UNAVAILABLE', 'Uploaded bytes could not be read');
  }
  const size = Number(r.size_bytes);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_MEDIA_BYTES) throw new ApiError(400, 'UPLOAD_SIZE_MISMATCH', 'Upload size is invalid');
  const bytes = new Uint8Array(size);
  const reader = data.getReader();
  let received = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (received + chunk.value.byteLength > size) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError(400, 'UPLOAD_SIZE_MISMATCH', 'Uploaded size does not match the reservation');
      }
      bytes.set(chunk.value, received); received += chunk.value.byteLength;
    }
  } finally { reader.releaseLock(); }
  if (received !== size) throw new ApiError(400, 'UPLOAD_SIZE_MISMATCH', 'Uploaded size does not match the reservation');
  return bytes;
}

export async function finalizeDirectUpload(owner: string, id: string, database: DirectUploadDatabase) {
  z.string().uuid().parse(id);
  const current = await transition(database, owner, id, 'get');
  await authorize(owner, current.request);
  const row = await transition(database, owner, id, 'claim');
  if (row.state === 'ready') return response(row);
  try {
    const bytes = await downloadedBytes(database, row, row.pending_path);
    const dimensions = await verifyUploadBytes(row, bytes);
    // Upload the verified buffer, not a mutable pending-path copy. The browser
    // never receives a ready-path permit and upsert is disabled on both paths.
    const stored = await database.storage.from(row.bucket).upload(row.ready_path, bytes, { contentType: row.mime, upsert: false });
    if (stored.error) {
      // A previous request can have written bytes then lost its DB response.
      // Recover only after independently checking the immutable ready object.
      await verifyUploadBytes(row, await downloadedBytes(database, row, row.ready_path));
    }
    const ready = await transition(database, owner, id, 'complete', row.lease_token, dimensions);
    return response(ready);
  } catch (error) {
    // An ambiguous completed transaction stays ready; this conditional RPC
    // cannot undo publication or release any quota.
    await transition(database, owner, id, 'retry', row.lease_token).catch(() => undefined);
    throw error;
  }
}

export async function cancelDirectUpload(owner: string, id: string, database: DirectUploadDatabase) {
  z.string().uuid().parse(id);
  const row = await transition(database, owner, id, 'cancel');
  // Do not delete a replay tombstone while its Supabase token is still valid.
  return { uploadId: id, cancelled: true, cleanupAfter: row.retain_until };
}

/** Independently callable by an operator job; bounded, lease-protected and safe to repeat. */
export async function cleanupDirectUploads(database: DirectUploadDatabase, limit = 10) {
  const { data, error } = await database.rpc('media_upload_cleanup_candidates', { p_limit: Math.max(0, Math.min(25, Math.floor(limit))) });
  if (error || !Array.isArray(data)) rpcError(error);
  let cleaned = 0;
  for (const candidate of data as UploadReservation[]) {
    try {
      const row = await transition(database, candidate.owner_id, candidate.id, 'cleanup');
      if (row.released_at) continue;
      const paths = row.state === 'ready' ? [row.pending_path] : [row.pending_path, row.ready_path];
      const removed = await database.storage.from(row.bucket).remove(paths);
      if (removed.error) continue;
      // The DB checks that Storage has actually removed every unfinalized object.
      await transition(database, row.owner_id, row.id, 'release', row.lease_token);
      cleaned++;
    } catch { /* Retain quota and retry next bounded sweep. */ }
  }
  return { inspected: data.length, cleaned };
}
