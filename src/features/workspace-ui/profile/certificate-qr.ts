/**
 * Server-side QR markup for a certificate's public verify URL, using the same `qrcode` package
 * as CertificateDocument. Loaded lazily so the flag-off profile page never pulls it in.
 * Returns null when the URL is not absolute (a relative path is useless once scanned) or on failure.
 */
export async function certificateQrSvg(url: string): Promise<string | null> {
  if (!/^https?:\/\//.test(url)) return null;
  try {
    const { default: QRCode } = await import('qrcode');
    return await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
  } catch {
    return null;
  }
}

/** Absolute verify URL from the canonical app origin, or the bare path when the origin is unset. */
export function certificateVerifyUrl(path: string, origin: string | undefined = process.env.NEXT_PUBLIC_APP_URL): string {
  if (!origin) return path;
  try {
    return new URL(path, origin).toString();
  } catch {
    return path;
  }
}
