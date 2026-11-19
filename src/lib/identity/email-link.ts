import 'server-only';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '@/lib/env';
import { routes } from '@/lib/routes';
import { safeInternalPath } from '@/lib/safe-internal-path';
import { authLinkRedirect } from './legacy-callback';
import { POPUP_ATTEMPT_PATTERN } from './popup-contract';

export const signInEmailTypes = z.enum(['email', 'email_change', 'invite', 'magiclink', 'signup']);
const grant = z.object({
  type: z.union([signInEmailTypes, z.literal('recovery')]),
  tokenHash: z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/),
  next: z.string().max(2048),
  popupAttempt: z.string().regex(POPUP_ATTEMPT_PATTERN).nullable(),
  origin: z.string(),
  expiresAt: z.number().int(),
});
type EmailGrant = z.infer<typeof grant>;

export const EMAIL_LINK_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-academy_email_link' : 'academy_email_link';
const LIFETIME_SECONDS = 600;

function cookieKey() {
  return createHmac('sha256', env.SUPABASE_SERVICE_ROLE_KEY).update('academy-email-link-cookie-v1').digest();
}

/** Stage the grant without redeeming it. The clean page receives only a confirmation fingerprint. */
export function stageEmailLink(
  request: Request, appUrl: URL, type: EmailGrant['type'], tokenHash: string, next: string, popupAttempt: string | null,
) {
  if (new URL(request.url).origin !== appUrl.origin) return null;
  const context = grant.safeParse({
    type, tokenHash, next: safeInternalPath(next.length <= 2048 ? next : null), popupAttempt,
    origin: appUrl.origin, expiresAt: Date.now() + LIFETIME_SECONDS * 1000,
  });
  if (!context.success) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cookieKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(context.data), 'utf8'), cipher.final()]);
  const value = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  if (value.length > 3800) return null;
  const response = authLinkRedirect(appUrl, routes.auth.confirmEmail(type === 'recovery' ? { recovery: 1 } : undefined));
  response.cookies.set(EMAIL_LINK_COOKIE, value, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production' || appUrl.protocol === 'https:',
    sameSite: 'lax', path: '/', maxAge: LIFETIME_SECONDS,
  });
  return response;
}

export function readEmailLink(value: string | undefined) {
  if (!value || value.length > 3800) return null;
  try {
    const packed = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', cookieKey(), packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const clear = Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
    const context = grant.parse(JSON.parse(clear.toString('utf8')));
    if (context.expiresAt <= Date.now()) return null;
    return { ...context, confirmation: createHash('sha256').update(value).digest('base64url') };
  } catch {
    return null;
  }
}
