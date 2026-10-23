import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { ApiError } from '@/lib/api';
import { env } from '@/lib/env';
import { ActorResolutionError, getActorForUserId, type Actor } from '@/lib/permissions';
import { enforceRateLimit, RATE_LIMITS, userRateLimitKey } from '@/lib/rate-limit';
import { assertMcpSessionCheck, mcpTesterUserIds } from '../config';
import type { ReadOnlyDatabase } from '../db/read-only-database';
import { StudioMcpError } from '../errors';
import { isMcpAccessBlocked } from './access-block';
import { validateMcpClient } from './client-allowlist';
import { verifyMcpToken, type McpAuthClient, type VerifiedMcpToken } from './verify-token';

export type McpPrincipal = { token: string; verified: VerifiedMcpToken; actor: Actor };

function bearerToken(request: Request): string {
  const value = request.headers.get('authorization');
  const match = value?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match) throw new StudioMcpError('UNAUTHENTICATED');
  return match[1];
}

function authClient(): McpAuthClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }).auth;
}

/** Resolves a fresh principal for one HTTP exchange, before the MCP SDK sees the body. */
export async function resolveMcpPrincipal(
  request: Request,
  db: ReadOnlyDatabase,
  options: { auth?: McpAuthClient; supabaseUrl?: string } = {},
): Promise<McpPrincipal> {
  const token = bearerToken(request);
  assertMcpSessionCheck();
  const verified = await verifyMcpToken(token, options.auth ?? authClient(), {
    supabaseUrl: options.supabaseUrl ?? env.NEXT_PUBLIC_SUPABASE_URL,
  });
  await validateMcpClient(db, verified.clientId);
  const testers = mcpTesterUserIds();
  if (testers.size > 0 && !testers.has(verified.userId)) throw new StudioMcpError('NOT_A_TESTER');
  try {
    if (await isMcpAccessBlocked(verified.userId, db)) throw new StudioMcpError('MCP_ACCESS_BLOCKED');
  } catch (error) {
    if (error instanceof StudioMcpError) throw error;
    throw new StudioMcpError('SERVICE_UNAVAILABLE');
  }
  try {
    await enforceRateLimit(db, userRateLimitKey('mcpRequest', verified.userId), RATE_LIMITS.mcpRequest);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'RATE_LIMITED') throw new StudioMcpError('RATE_LIMITED', { retryAfterSeconds: 60 });
    throw new StudioMcpError('RATE_LIMIT_UNAVAILABLE');
  }
  let actor: Actor;
  try { actor = await getActorForUserId(verified.userId, db); }
  catch (error) {
    if (error instanceof ActorResolutionError && error.reason === 'missing_account') throw new StudioMcpError('ACCOUNT_NOT_PROVISIONED');
    throw new StudioMcpError('SERVICE_UNAVAILABLE');
  }
  if (actor.authorization?.accountStatus === 'suspended') throw new StudioMcpError('ACCOUNT_SUSPENDED');
  return { token, verified, actor };
}
