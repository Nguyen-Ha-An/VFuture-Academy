import 'server-only';

import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { authorizeAssignmentUpload } from '@/features/submissions/service';
import { ApiError } from '@/lib/api';
import { readBodyLimited } from '@/lib/body-limit';
import type { supabaseService } from '@/lib/supabase/server';
import { mediaAssetId } from './upload';
import type { DirectUploadInput } from './direct-upload';

const table = 'academy_assignment_files';
const origin = 'https://files.vfuturelabs.org';
const pdf = 'application/pdf';
const maxBytes = 4 * 1024 * 1024;
const uuid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.object({
  operation_id: uuid, asset_id: z.string(), owner_id: uuid, course_id: z.string(), course_version_id: uuid,
  item_id: z.string(), branch_id: z.string().nullable(), filename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/),
  size_bytes: z.number().int().positive().max(maxBytes), sha256: digest,
  source_ref: z.string().regex(/^assignment\/[a-f0-9]{64}$/), file_id: uuid.nullable(),
  cancelled_at: z.string().nullable(), expires_at: z.string().datetime({ offset: true }),
});
export type AssignmentFile = z.infer<typeof schema>;
export type AssignmentFileDatabase = Pick<ReturnType<typeof supabaseService>, 'from' | 'rpc'>;
const missing = () => new ApiError(404, 'UPLOAD_NOT_FOUND', 'Attachment not found');
const unavailable = () => new ApiError(503, 'FILES_UNAVAILABLE', 'Assignment attachment storage is temporarily unavailable');
const paused = () => new ApiError(409, 'UPLOAD_PAUSED', 'Assignment file uploads are paused');
const expired = () => new ApiError(409, 'UPLOAD_EXPIRED', 'Upload expired');
const conflict = () => new ApiError(409, 'UPLOAD_CONFLICT', 'Upload details changed');

function selected(courseId: string, itemId: string) {
  return courseId === process.env.ACADEMY_FILES_ASSIGNMENT_COURSE_ID
    && itemId === process.env.ACADEMY_FILES_ASSIGNMENT_ITEM_ID;
}
function writesEnabled() {
  return process.env.ACADEMY_FILES_ASSIGNMENT_WRITES_ENABLED === 'true';
}

export function isAssignmentFilesCandidate(input: DirectUploadInput) {
  return input.purpose === 'submission' && input.blockId == null
    && !input.examAttemptId && !input.quizId
    && input.mime === pdf && input.size <= maxBytes
    && input.courseId !== undefined && input.itemId !== undefined && selected(input.courseId, input.itemId);
}

function parsed(value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw unavailable();
  return result.data;
}

async function load(database: AssignmentFileDatabase, operation: string, owner: string) {
  const { data, error } = await database.from(table).select('*')
    .eq('operation_id', operation).eq('owner_id', owner).maybeSingle();
  if (error) throw unavailable();
  return data ? parsed(data) : null;
}

async function authorizedScope(database: AssignmentFileDatabase, owner: string, courseId: string, itemId: string, size: number) {
  const { courseVersionId } = await authorizeAssignmentUpload(
    { userId: owner, roles: [] }, { courseId, itemId, blockId: null }, { size, mime: pdf },
  );
  const { data, error } = await database.from('enrollments').select('branch_scope_known,branch_id')
    .eq('user_id', owner).eq('course_id', courseId).eq('course_version_id', courseVersionId)
    .in('status', ['active', 'completed']).maybeSingle();
  if (error) throw unavailable();
  if (data?.branch_scope_known !== true || (data.branch_id !== null && typeof data.branch_id !== 'string')) throw missing();
  return { version: courseVersionId, branch: data.branch_id as string | null };
}

async function checkCurrentScope(database: AssignmentFileDatabase, attachment: AssignmentFile) {
  const scope = await authorizedScope(database, attachment.owner_id, attachment.course_id, attachment.item_id, attachment.size_bytes);
  if (scope.version !== attachment.course_version_id || scope.branch !== attachment.branch_id) throw missing();
}

function assertPending(attachment: AssignmentFile) {
  if (attachment.cancelled_at || Date.parse(attachment.expires_at) <= Date.now()) throw expired();
}

function result(attachment: AssignmentFile) {
  return { assetId: attachment.asset_id, name: attachment.filename, size: attachment.size_bytes, mime: pdf };
}

export async function reserveAssignmentFile(database: AssignmentFileDatabase, owner: string, input: DirectUploadInput) {
  if (!isAssignmentFilesCandidate(input)) return null;
  const course = input.courseId!;
  const item = input.itemId!;
  const operation = input.uploadId;
  let attachment = await load(database, operation, owner);
  if (!attachment) {
    if (!writesEnabled()) return null;
    const { data: legacy, error } = await database.from('media_upload_reservations').select('id')
      .eq('id', operation).eq('owner_id', owner).maybeSingle();
    if (error) throw unavailable();
    if (legacy) return null;
  }
  const scope = await authorizedScope(database, owner, course, item, input.size);
  if (!attachment) {
    const source = JSON.stringify([owner, course, scope.version, item, scope.branch]);
    const { error } = await database.from(table).insert({
      operation_id: operation, asset_id: mediaAssetId(), owner_id: owner, course_id: course, item_id: item,
      course_version_id: scope.version, branch_id: scope.branch, filename: input.name,
      size_bytes: input.size, sha256: input.checksum,
      source_ref: 'assignment/' + createHash('sha256').update(source).digest('hex'),
    });
    if (error && error.code !== '23505') throw unavailable();
    attachment = await load(database, operation, owner);
    if (!attachment) throw missing();
  }
  if (attachment.course_id !== course || attachment.item_id !== item || attachment.filename !== input.name
    || attachment.sha256 !== input.checksum || attachment.size_bytes !== input.size
    || attachment.course_version_id !== scope.version || attachment.branch_id !== scope.branch) throw conflict();
  if (attachment.file_id) return { uploadId: operation, file: result(attachment) };
  if (!writesEnabled()) throw paused();
  assertPending(attachment);
  return { uploadId: operation, uploadUrl: `/api/v1/uploads/${operation}/assignment-file`, method: 'PUT', provider: 'vfuture-files' };
}

function fileHeaders(attachment: AssignmentFile, action: 'upload' | 'download', target: string) {
  const token = process.env.ACADEMY_FILES_ASSIGNMENT_TOKEN;
  const secret = process.env.ACADEMY_FILES_ASSIGNMENT_PROOF_KEY ?? '';
  if (!/^vfs1\.academyassignment\.[A-Za-z0-9_-]{43}$/.test(token ?? '') || !/^[a-f0-9]{64}$/.test(secret)) throw unavailable();
  const expires = Math.floor(Date.now() / 1000) + 45;
  const payload = JSON.stringify(['academyassignment', action, attachment.source_ref, target, expires]);
  const proof = createHmac('sha256', Buffer.from(secret, 'hex')).update(payload).digest('hex');
  return new Headers({
    Authorization: 'Bearer ' + token,
    'X-Files-Source-Ref': attachment.source_ref,
    'X-Files-Record-Proof': expires + '.' + proof,
  });
}

async function filesRequest(path: string, init: RequestInit) {
  const response = await fetch(origin + '/api/v1/service/assignment-files' + path, {
    ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(14000),
  }).catch(() => { throw unavailable(); });
  if (response.status === 409) throw conflict();
  if (!response.ok) throw unavailable();
  return response;
}

export async function transferAssignmentFile(database: AssignmentFileDatabase, owner: string, operation: string, request: Request) {
  if (!uuid.safeParse(operation).success) throw missing();
  const attachment = await load(database, operation, owner);
  if (!attachment) throw missing();
  await checkCurrentScope(database, attachment);
  if (!attachment.file_id) {
    if (!writesEnabled() || !selected(attachment.course_id, attachment.item_id)) throw paused();
    assertPending(attachment);
  }
  const bytes = await readBodyLimited(request, attachment.size_bytes);
  if (request.headers.get('content-type') !== pdf || bytes.byteLength !== attachment.size_bytes
    || createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) {
    throw new ApiError(400, 'CHECKSUM_MISMATCH', 'Uploaded bytes do not match the reservation');
  }
  if (attachment.file_id) return result(attachment);
  const headers = fileHeaders(attachment, 'upload', operation + ':' + attachment.sha256);
  headers.set('X-Files-Sha256', attachment.sha256);
  headers.set('Idempotency-Key', operation);
  const form = new FormData();
  form.set('sourceRef', attachment.source_ref);
  form.set('file', new Blob([Uint8Array.from(bytes)], { type: pdf }), attachment.filename);
  const response = await filesRequest('', { method: 'POST', headers, body: form });
  let body: unknown;
  try { body = JSON.parse(Buffer.from(await readBodyLimited(response, 8192)).toString('utf8')); }
  catch { throw unavailable(); }
  const stored = z.object({ file: z.object({ fileId: uuid, sha256: digest, sizeBytes: z.number(), contentType: z.literal(pdf) }) })
    .safeParse(body);
  if (!stored.success || stored.data.file.sha256 !== attachment.sha256 || stored.data.file.sizeBytes !== attachment.size_bytes) throw unavailable();
  await checkCurrentScope(database, attachment);
  const { data, error } = await database.rpc('academy_assignment_file_complete', {
    p_owner: owner, p_operation: operation, p_file: stored.data.file.fileId,
  });
  if (error?.message.includes('UPLOAD_EXPIRED')) throw expired();
  if (error?.message.includes('UPLOAD_NOT_FOUND')) throw missing();
  if (error?.message.includes('UPLOAD_CONFLICT')) throw conflict();
  if (error) throw unavailable();
  return result(parsed(data));
}

export async function cancelAssignmentFile(database: AssignmentFileDatabase, owner: string, operation: string) {
  if (!uuid.safeParse(operation).success) throw missing();
  const { error } = await database.from(table).update({ cancelled_at: new Date().toISOString() })
    .eq('operation_id', operation).eq('owner_id', owner).is('file_id', null).is('cancelled_at', null);
  if (error) throw unavailable();
  return { cancelled: true };
}

export function usesAssignmentFiles(path: string) {
  return path.split('/')[1] === 'vfuture-files';
}

export async function assignmentFileForAsset(database: AssignmentFileDatabase, owner: string, assetId: string, path: string) {
  const [pathOwner, provider, operation, ...extra] = path.split('/');
  if (pathOwner !== owner || provider !== 'vfuture-files' || extra.length || !uuid.safeParse(operation).success) throw missing();
  const attachment = await load(database, operation, owner);
  if (!attachment?.file_id || attachment.asset_id !== assetId) throw missing();
  return attachment;
}

export async function checkAssignmentFileOwner(database: AssignmentFileDatabase, attachment: AssignmentFile) {
  await checkCurrentScope(database, attachment);
}

export async function downloadAssignmentFile(attachment: AssignmentFile) {
  const id = attachment.file_id;
  if (!id) throw missing();
  const response = await filesRequest('/' + id + '/download', { headers: fileHeaders(attachment, 'download', id) });
  if (response.headers.get('content-type') !== pdf) throw unavailable();
  const bytes = await readBodyLimited(response, attachment.size_bytes);
  if (bytes.byteLength !== attachment.size_bytes || createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) throw unavailable();
  return new Response(Uint8Array.from(bytes), { headers: {
    'Content-Type': pdf, 'Content-Disposition': `attachment; filename="${attachment.filename}"`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie',
  } });
}
