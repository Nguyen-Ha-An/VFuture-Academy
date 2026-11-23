/** Reads the trusted Storage response solely to retain bytes until its token expires. */
export function signedUploadExpiry(url: string): string | null {
  try {
    const payload = new URL(url).searchParams.get('token')?.split('.')[1];
    if (!payload) return null;
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isSafeInteger(exp) || exp * 1000 <= Date.now()) return null;
    return new Date(exp * 1000).toISOString();
  } catch {
    return null;
  }
}
