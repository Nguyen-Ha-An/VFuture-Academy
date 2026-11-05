import 'server-only';

import { cookies } from 'next/headers';
import { ADMIN_SCOPE_COOKIE } from '@/lib/admin-scope';
import { ApiError } from '@/lib/api';

/** A fallback authorized context must not conceal a cookie changed in another tab. */
export async function assertSavedScopePrecondition(request: Request): Promise<void> {
  const expected = request.headers.get('x-vfuture-expected-saved-scope');
  if (expected === null) return;
  const actual = (await cookies()).get(ADMIN_SCOPE_COOKIE)?.value ?? '';
  if (expected !== actual) {
    throw new ApiError(409, 'SCOPE_CHANGED', 'The active school changed. Reload before continuing.');
  }
}
