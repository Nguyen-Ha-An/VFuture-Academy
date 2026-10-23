import 'server-only';

import { isAuthSessionMissingError } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { cache } from 'react';
import { forbidden, redirect } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { assertActiveAccount } from '@/lib/account-access';
import { routes } from '@/lib/routes';
import { REQUESTED_PATH_HEADER, safeInternalPath } from '@/lib/safe-internal-path';
import { supabaseUser } from '@/lib/supabase/server';

/**
 * Reads the authenticated user from Supabase after its token has been verified. Memoized per
 * server render (React `cache`), so a layout's auth check and the staff chrome's identity share
 * one Auth round trip; outside a render (route handlers, tests) every call goes to Supabase.
 */
export const getSessionUser = cache(async function getSessionUser() {
  try {
    const supabase = await supabaseUser();
    const { data, error } = await supabase.auth.getUser();
    if (!data.user && error && isAuthSessionMissingError(error)) return null;
    if (error) throw error;
    return data.user;
  } catch {
    throw new Error('Unable to authenticate user');
  }
});

/** Reads the path written by middleware, ignoring any caller-provided header value. */
export async function requestedInternalPath(fallback = routes.learner.dashboard()): Promise<string> {
  try {
    const requestHeaders = await headers();
    return safeInternalPath(requestHeaders.get(REQUESTED_PATH_HEADER), fallback);
  } catch {
    return fallback;
  }
}

/** Builds a login destination that retains an explicit or middleware-derived return path. */
export async function loginDestination(returnTo?: string): Promise<string> {
  const next = returnTo
    ? safeInternalPath(returnTo)
    : await requestedInternalPath();
  return routes.auth.login({ next });
}

/** Returns the signed-in user or stops rendering and sends the visitor to login. */
export async function requireUser(returnTo?: string) {
  const user = await getSessionUser();
  if (!user) redirect(await loginDestination(returnTo));
  try { await assertActiveAccount(user.id); } catch (error) {
    if (error instanceof ApiError && error.status === 403) forbidden();
    throw error;
  }
  return user;
}

/** Returns the signed-in user to an API route without invoking page navigation. */
export async function requireApiUser() {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  await assertActiveAccount(user.id);
  return user;
}
