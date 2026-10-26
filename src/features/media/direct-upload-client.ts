import type { UploadedFile, UploadProgress } from '@/content-engine/render/runtime';
import { MAX_SUBMISSION_UPLOAD_MB } from '@/content-engine/schema/uploads';

type UploadContext = { purpose: 'avatar' | 'project_cover' | 'submission'; courseId?: string; itemId?: string; blockId?: string | null };
type UploadOptions = { signal?: AbortSignal; onProgress?: (progress: UploadProgress) => void; fetchImpl?: typeof fetch };
export type DirectUploadedFile = UploadedFile & { url?: string };
type Permit = { uploadId: string; uploadUrl?: string; method?: 'PUT'; file?: DirectUploadedFile };
export class DirectUploadError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) { super(message); this.name = 'DirectUploadError'; }
}
const cancelled = () => new DirectUploadError('UPLOAD_CANCELLED', 'Upload cancelled');
const assertNotAborted = (signal?: AbortSignal) => { if (signal?.aborted) throw cancelled(); };
// Keep the identity across an explicit UI retry of the same File and context.
// Server-side admission/quota/idempotency never depend on this browser cache.
const retries = new WeakMap<File, { context: string; id: string }>();
// All upload surfaces in this browser share one authenticated owner. Hold the
// slot through finalization/cancellation so a multi-file selection respects the
// server's one-active-reservation rule. Aborted waiters still preserve ordering.
let uploadQueueTail: Promise<void> = Promise.resolve();
function acquireUploadSlot(signal?: AbortSignal): Promise<() => void> {
  const predecessor = uploadQueueTail;
  let release!: () => void;
  const completed = new Promise<void>((resolve) => { release = resolve; });
  uploadQueueTail = predecessor.then(() => completed);
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      release();
      reject(cancelled());
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    void predecessor.then(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      resolve(release);
    });
  });
}

async function fileBytes(file: File) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new DirectUploadError('READ_FAILED', 'File could not be read'));
    reader.readAsArrayBuffer(file);
  });
}
async function unwrap<T>(response: Response): Promise<T> {
  let body;
  try { body = await response.json(); } catch { throw new DirectUploadError('INVALID_RESPONSE', 'Upload returned an invalid response', response.status); }
  if (!response.ok) throw new DirectUploadError(body.error?.code ?? 'UPLOAD_FAILED', body.error?.message ?? 'Upload failed', response.status);
  if (!body || !Object.hasOwn(body, 'data')) throw new DirectUploadError('INVALID_RESPONSE', 'Upload response did not contain data', response.status);
  return body.data as T;
}
function transferWithProgress(url: string, file: File, options: UploadOptions) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => options.signal?.removeEventListener('abort', abort);
    xhr.open('PUT', url);
    xhr.withCredentials = false;
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.addEventListener('progress', (event) => {
      const total = file.size;
      const loaded = Math.min(total, Math.max(0, event.loaded));
      options.onProgress?.({ loaded, total, percent: Math.round(loaded / total * 100) });
    });
    xhr.addEventListener('load', () => { cleanup(); if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new DirectUploadError('TRANSFER_FAILED', 'File transfer failed', xhr.status)); });
    xhr.addEventListener('error', () => { cleanup(); reject(new DirectUploadError('NETWORK_ERROR', 'File transfer failed')); });
    xhr.addEventListener('abort', () => { cleanup(); reject(cancelled()); });
    if (options.signal?.aborted) { reject(cancelled()); return; }
    options.signal?.addEventListener('abort', abort, { once: true });
    xhr.send(file);
  });
}

/** Reserve → raw signed PUT → verified finalization. App requests stay small JSON. */
async function performDirectUpload(file: File, context: UploadContext, options: UploadOptions): Promise<DirectUploadedFile> {
  assertNotAborted(options.signal);
  if (file.size < 1 || file.size > MAX_SUBMISSION_UPLOAD_MB * 1024 * 1024) throw new DirectUploadError('FILE_TOO_LARGE', 'Choose a nonempty file up to 50 MiB');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const key = JSON.stringify(context), previous = retries.get(file);
  const uploadId = previous?.context === key ? previous.id : crypto.randomUUID();
  retries.set(file, { context: key, id: uploadId });
  let reservationAttempted = false;
  const json = async <T>(url: string, body: unknown) => unwrap<T>(await fetchImpl(url, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: options.signal,
  }));
  const finalize = () => json<DirectUploadedFile>(`/api/v1/uploads/${uploadId}/finalize`, {});
  const finish = (result: DirectUploadedFile) => {
    retries.delete(file);
    options.onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
    return result;
  };
  try {
    const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await fileBytes(file)))].map((n) => n.toString(16).padStart(2, '0')).join('');
    assertNotAborted(options.signal);
    const body = { ...context, uploadId, name: file.name, size: file.size, mime: file.type, checksum };
    for (let attempt = 0; attempt < 2; attempt++) {
      // A lost reserve response is safe to retry with the same client UUID.
      let permit: Permit;
      reservationAttempted = true;
      try { permit = await json<Permit>('/api/v1/uploads/reserve', body); }
      catch (error) { if (!(error instanceof DirectUploadError) && !options.signal?.aborted && attempt === 0) continue; throw error; }
      if (permit.file) return finish(permit.file);
      if (typeof permit.uploadUrl !== 'string' || permit.method !== 'PUT') throw new DirectUploadError('INVALID_RESPONSE', 'Upload permit is invalid');
      assertNotAborted(options.signal);
      try {
        if (options.onProgress && typeof XMLHttpRequest !== 'undefined') await transferWithProgress(permit.uploadUrl, file, options);
        else {
          const uploaded = await fetchImpl(permit.uploadUrl, { method: 'PUT', credentials: 'omit', headers: { 'content-type': file.type }, body: file, signal: options.signal });
          if (!uploaded.ok) throw new DirectUploadError('TRANSFER_FAILED', 'File transfer failed', uploaded.status);
        }
      } catch (error) {
        assertNotAborted(options.signal);
        // An interrupted response may still have committed the object. Resolve
        // that ambiguity before obtaining a fresh one-use gateway grant.
        try { return finish(await finalize()); }
        catch (finalizeError) {
          if (attempt === 0 && finalizeError instanceof DirectUploadError && finalizeError.code === 'UPLOAD_NOT_FOUND') continue;
          throw finalizeError instanceof DirectUploadError ? finalizeError : error;
        }
      }
      assertNotAborted(options.signal);
      try { return finish(await finalize()); }
      catch (error) {
        assertNotAborted(options.signal);
        // Finalize is idempotent. Retry an ambiguous network response exactly
        // once; a concurrent server lease produces an explicit retryable error.
        if (!(error instanceof DirectUploadError) || error.status >= 500) return finish(await finalize());
        throw error;
      }
    }
    throw new DirectUploadError('NETWORK_ERROR', 'Upload could not be completed');
  } catch (error) {
    const terminal = error instanceof DirectUploadError && ['UPLOAD_EXPIRED', 'CHECKSUM_MISMATCH', 'UPLOAD_SIZE_MISMATCH', 'UNSUPPORTED_MEDIA'].includes(error.code);
    if (options.signal?.aborted || terminal) {
      retries.delete(file);
      if (reservationAttempted) await fetchImpl(`/api/v1/uploads/${uploadId}`, { method: 'DELETE', credentials: 'same-origin', keepalive: true }).catch(() => undefined);
      if (options.signal?.aborted) throw cancelled();
    }
    if (error instanceof DirectUploadError) throw error;
    throw new DirectUploadError('NETWORK_ERROR', error instanceof Error ? error.message : 'Upload failed');
  }
}

/** Serializes browser admission while allowing queued cancellation immediately. */
export async function directUploadFile(file: File, context: UploadContext, options: UploadOptions = {}): Promise<DirectUploadedFile> {
  assertNotAborted(options.signal);
  const release = await acquireUploadSlot(options.signal);
  try { return await performDirectUpload(file, context, options); }
  finally { release(); }
}
