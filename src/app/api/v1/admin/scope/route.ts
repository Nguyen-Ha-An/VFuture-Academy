import { z } from 'zod';
import { cookies } from 'next/headers';
import { ApiError, ok, parseBody, withHandler } from '@/lib/api';
import { ADMIN_SCOPE_COOKIE, scopeKey } from '@/lib/admin-scope';
import { assertSameOrigin, getAdminContext } from '@/features/admin/context';

export const POST = withHandler(async request => {
  assertSameOrigin(request);
  const input = await parseBody(z.object({ scope: z.string().max(80) }).strict(), request);
  const context = await getAdminContext();
  if (!context.options.some(option => scopeKey(option.scope) === input.scope)) {
    throw new ApiError(403, 'FORBIDDEN', 'Scope not available');
  }
  (await cookies()).set(ADMIN_SCOPE_COOKIE, input.scope, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30,
  });
  return ok({ scope: input.scope }, { headers: { 'Cache-Control': 'private, no-store' } });
});
