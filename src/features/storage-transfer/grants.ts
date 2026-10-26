import 'server-only';
import { createHmac, randomUUID } from 'node:crypto';

export type StorageTransfer = {
  /** The authenticated viewer, or public only after an explicit public-access check. */
  subject: string;
  method: 'GET' | 'HEAD' | 'PUT' | 'POST';
  bucket: string;
  path: string;
  maxBytes: unknown;
  expiresIn?: number;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new Error('Invalid storage transfer grant request');

function objectPath(bucket: string, path: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(bucket)) throw invalid();
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[%\\\x00-\x1f\x7f]/.test(segment))) throw invalid();
  return `${bucket}/${segments.map(encodeURIComponent).join('/')}`;
}

/** Adds an app-authorized gateway permit; the ordinary Supabase signed token is still required. */
export function grantStorageTransferUrl(
  signedUrl: string,
  transfer: StorageTransfer,
  source: Readonly<Record<string, string | undefined>> = process.env,
): string {
  // Keep the hosted migration/rollback path byte-for-byte compatible.
  if (!source.SUPABASE_GATEWAY_KEY) return signedUrl;
  const secret = source.SUPABASE_TRANSFER_GRANT_KEY;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Missing or invalid SUPABASE_TRANSFER_GRANT_KEY');
  }
  const download = transfer.method === 'GET' || transfer.method === 'HEAD';
  if ((!download && transfer.method !== 'PUT' && transfer.method !== 'POST')
    || (!UUID.test(transfer.subject) && !(download && transfer.subject === 'public'))
    || typeof transfer.maxBytes !== 'number' || !Number.isSafeInteger(transfer.maxBytes) || transfer.maxBytes <= 0
    || transfer.maxBytes > (download ? 100 : 50) * 1024 * 1024) throw invalid();
  const lifetime = transfer.expiresIn ?? 300;
  if (!Number.isSafeInteger(lifetime) || lifetime <= 0) throw invalid();
  const path = `/storage/v1/object/${download ? '' : 'upload/'}sign/${objectPath(transfer.bucket, transfer.path)}`;
  let expected: URL;
  let actual: URL;
  try {
    expected = new URL(source.NEXT_PUBLIC_SUPABASE_URL ?? '');
    actual = new URL(signedUrl);
  } catch { throw invalid(); }
  // Check the raw path too: URL() normalizes dot segments before exposing pathname.
  const raw = /^https:\/\/[^/?#]+([^?#]*)(?:\?[^#]*)?$/.exec(signedUrl);
  if (expected.protocol !== 'https:' || expected.username || expected.password || expected.search || expected.hash
    || (expected.pathname !== '/' && expected.pathname !== '')
    || actual.origin !== expected.origin || actual.username || actual.password || actual.hash
    || !raw || raw[1] !== path || actual.pathname !== path) throw invalid();
  const keys = [...actual.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some((key) => !['token', 'download'].includes(key))
    || !actual.searchParams.get('token')) throw invalid();
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    aud: 'vfuture-storage-transfer',
    sub: transfer.subject,
    jti: randomUUID(),
    method: transfer.method,
    path,
    maxBytes: transfer.maxBytes,
    exp: Math.floor(Date.now() / 1000) + Math.min(lifetime, 900),
  })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  // Append without reserializing token/download query values from Supabase.
  return `${signedUrl}&gateway_grant=${payload}.${signature}`;
}
