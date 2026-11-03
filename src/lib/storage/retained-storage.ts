import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type Storage = SupabaseClient['storage'];
type Database = Pick<SupabaseClient, 'rpc'>;

export function createRetainedStorage(source: Readonly<Record<string, string | undefined>> = process.env) {
  const url = source.SUPABASE_STORAGE_URL;
  const key = source.SUPABASE_STORAGE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Retained Storage credentials are required');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Invalid SUPABASE_STORAGE_URL');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) }) } }).storage;
}

/** Every inventory write is based on Storage's object-info API, never caller metadata. */
export function withVerifiedInventory(storage: Storage, database: Database): Storage {
  async function observe(bucket: string, path: string, file: ReturnType<Storage['from']>, removed = false) {
    const result = await file.info(path);
    const missing = result.error && 'statusCode' in result.error && String(result.error.statusCode) === '404';
    if (removed ? !missing : result.error || !result.data) throw new Error('Storage inventory verification failed');
    const size = result.data?.size ?? result.data?.metadata?.size;
    const mime = result.data?.contentType ?? result.data?.metadata?.mimetype;
    if (!removed && (!Number.isSafeInteger(Number(size)) || Number(size) < 0 || typeof mime !== 'string')) throw new Error('Storage inventory metadata is invalid');
    const { error } = await database.rpc('academy_storage_observe', {
      p_bucket: bucket, p_path: path, p_metadata: removed ? null : { size: Number(size), mimetype: mime },
    });
    if (error) throw new Error('Storage inventory persistence failed');
  }
  return new Proxy(storage, {
    get(target, property) {
      if (property !== 'from') {
        if (['createBucket', 'updateBucket', 'deleteBucket', 'emptyBucket'].includes(String(property))) throw new Error('Bucket administration requires a reconciled operator workflow');
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (bucket: string) => {
        const file = target.from(bucket);
        return new Proxy(file, { get(object, method) {
          if (method === 'upload') return async (...args: Parameters<typeof file.upload>) => {
            if (args[2]?.upsert) throw new Error('Azure Storage writes must be immutable');
            const body = args[1];
            const size = body instanceof Blob ? body.size : body instanceof ArrayBuffer ? body.byteLength : ArrayBuffer.isView(body) ? body.byteLength : null;
            if (!Number.isSafeInteger(size) || size === null || size < 1) throw new Error('Storage inventory requires a bounded upload body');
            const held = await database.rpc('academy_storage_begin_write', { p_bucket: bucket, p_path: args[0], p_size: size, p_mime: args[2]?.contentType ?? (body instanceof Blob ? body.type : '') });
            if (held.error) throw new Error('Storage inventory write admission failed');
            const result = await file.upload(...args);
            // Even a conflict may be a prior successful immutable write whose DB
            // response was lost. Reobserve it before the caller's checksum recovery.
            await observe(bucket, args[0], file);
            return result;
          };
          if (method === 'remove') return async (paths: string[]) => {
            const result = await file.remove(paths);
            const alreadyMissing = result.error && 'statusCode' in result.error && String(result.error.statusCode) === '404';
            if (!result.error || alreadyMissing) for (const path of paths) await observe(bucket, path, file, true);
            return alreadyMissing ? { data: [], error: null } : result;
          };
          if (method === 'createSignedUploadUrl') return async (...args: Parameters<typeof file.createSignedUploadUrl>) => {
            const maximum = bucket === 'notebooks' ? 10 * 1024 * 1024 : ['media', 'submissions'].includes(bucket) ? 50 * 1024 * 1024 : 0;
            const configured = await target.getBucket(bucket);
            const nativeLimit = configured.data?.file_size_limit;
            if (configured.error || configured.data?.public !== false || !maximum || !Number.isSafeInteger(nativeLimit) || !nativeLimit || nativeLimit < 1 || nativeLimit > maximum) throw new Error('A verified native Storage bucket limit is required for signed uploads');
            const held = await database.rpc('academy_storage_reserve_signed', { p_bucket: bucket, p_path: args[0] });
            if (held.error) throw new Error('Storage upload reservation failed');
            const result = await file.createSignedUploadUrl(...args);
            if (result.error || !result.data) return result;
            let expiry: number;
            try {
              const token = new URL(result.data.signedUrl).searchParams.get('token');
              expiry = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString()).exp;
              if (!Number.isSafeInteger(expiry) || expiry * 1000 <= Date.now()) throw new Error();
            } catch { throw new Error('Storage signing returned an invalid expiry'); }
            const confirmation = await database.rpc('academy_storage_confirm_signed', { p_bucket: bucket, p_path: args[0], p_expires_at: new Date(expiry * 1000).toISOString() });
            if (confirmation.error) throw new Error('Storage token retention could not be recorded');
            return result;
          };
          if (['update', 'move', 'copy'].includes(String(method))) throw new Error('Mutable storage operations require an inventory-aware workflow');
          const value = Reflect.get(object, method);
          return typeof value === 'function' ? value.bind(object) : value;
        } });
      };
    },
  });
}

/** Called by the protected five-minute sweep; never releases an unexpired token hold. */
export async function reconcileExpiredStorageHolds(database: Pick<SupabaseClient, 'rpc' | 'storage'>, limit = 25) {
  const candidates = await database.rpc('academy_storage_expired_holds', { p_limit: Math.max(0, Math.min(100, Math.floor(limit))) });
  if (candidates.error || !Array.isArray(candidates.data)) throw new Error('Storage inventory cleanup unavailable');
  let reconciled = 0;
  for (const candidate of candidates.data as { bucket_id: string; name: string; observed_at: string }[]) {
    const observed = await database.storage.from(candidate.bucket_id).info(candidate.name);
    const absent = observed.error && 'statusCode' in observed.error && String(observed.error.statusCode) === '404';
    if (observed.error && !absent) continue;
    const size = observed.data?.size ?? observed.data?.metadata?.size;
    const mime = observed.data?.contentType ?? observed.data?.metadata?.mimetype;
    if (!absent && (!Number.isSafeInteger(Number(size)) || Number(size) < 0 || typeof mime !== 'string')) continue;
    const result = await database.rpc('academy_storage_reconcile_hold', {
      p_bucket: candidate.bucket_id, p_path: candidate.name, p_observed_at: candidate.observed_at,
      p_metadata: absent ? null : { size: Number(size), mimetype: mime },
    });
    if (result.error) throw new Error('Storage inventory reconciliation failed');
    if (result.data === true) reconciled++;
  }
  return { inspected: candidates.data.length, reconciled };
}
