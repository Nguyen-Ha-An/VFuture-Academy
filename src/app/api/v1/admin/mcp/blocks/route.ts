import { z } from 'zod';

import { assertAdminPermission, assertRequestScope, getAdminContext } from '@/features/admin/context';
import { blockMcpAccess, unblockMcpAccess } from '@/features/admin/mcp-access-blocks';
import { getMcpAccessBlock, type McpAccessBlock, type McpBlockDatabase } from '@/features/studio-mcp/auth/access-block';
import { ApiError, ok, parseBody, withHandler } from '@/lib/api';
import { audit } from '@/lib/audit';
import { reportError } from '@/lib/observability';
import { enforceRateLimit, RATE_LIMITS, userRateLimitKey } from '@/lib/rate-limit';
import { supabaseService } from '@/lib/supabase/server';

const UserId = z.uuid();
const BlockInput = z.object({ userId: UserId, reason: z.string().trim().min(1).max(500).optional() }).strict();
const UnblockInput = z.object({ userId: UserId }).strict();
const PRIVATE = { headers: { 'Cache-Control': 'private, no-store' } };

function status(userId: string, block: McpAccessBlock | null) {
  return {
    userId,
    blocked: block !== null,
    reason: block?.reason ?? null,
    blockedAt: block?.blockedAt ?? null,
    blockedBy: block?.blockedBy ?? null,
    scope: 'all-mcp-clients' as const,
    // Application MCP admission only: existing Supabase OAuth grants remain valid.
    oauthGrantRevoked: false as const,
  };
}

async function centralContext(request: Request) {
  const context = await getAdminContext();
  assertRequestScope(context, request);
  if (context.scope.kind !== 'central') throw new ApiError(403, 'FORBIDDEN', 'Central administration scope required');
  assertAdminPermission(context, 'user.manage.global');
  return context;
}

function mutationRequest(request: Request): void {
  if (request.headers.get('origin') !== new URL(request.url).origin
    || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'FORBIDDEN', 'Same-origin administration request required');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON body required');
  }
}

async function mutationLimit(actorId: string, db: ReturnType<typeof supabaseService>) {
  await enforceRateLimit(db, userRateLimitKey('mcp:admin-block', actorId), RATE_LIMITS.mcpAdminBlock);
}

async function requireTargetProfile(userId: string, db: ReturnType<typeof supabaseService>): Promise<void> {
  let result: { data: { id?: string } | null; error: unknown | null };
  try {
    result = await db.from('profiles').select('id').eq('id', userId).maybeSingle();
  } catch {
    throw new ApiError(503, 'MCP_ACCESS_UNAVAILABLE', 'MCP access status is unavailable');
  }
  if (result.error || (result.data !== null && result.data?.id !== userId)) {
    throw new ApiError(503, 'MCP_ACCESS_UNAVAILABLE', 'MCP access status is unavailable');
  }
  if (!result.data) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
}

async function auditChange(
  actor: Awaited<ReturnType<typeof getAdminContext>>['actor'],
  action: 'mcp.access.block' | 'mcp.access.unblock',
  userId: string,
  before: { blocked: boolean } | null,
  after: { blocked: boolean },
) {
  try {
    await audit(actor, action, { type: 'user', id: userId }, before, after);
  } catch (error) {
    // The row already committed. Report the audit outage without claiming the change failed.
    reportError(error, { area: 'admin-mcp', action, actorId: actor.userId, targetUserId: userId });
  }
}

export const GET = withHandler(async (request) => {
  await centralContext(request);
  const userId = UserId.parse(new URL(request.url).searchParams.get('userId'));
  const db = supabaseService();
  await requireTargetProfile(userId, db);
  const block = await getMcpAccessBlock(userId, db as unknown as McpBlockDatabase);
  return ok(status(userId, block), PRIVATE);
});

export const POST = withHandler(async (request) => {
  mutationRequest(request);
  const context = await centralContext(request);
  const { userId, reason } = await parseBody(BlockInput, request, { maxBytes: 1_024 });
  const db = supabaseService();
  await mutationLimit(context.actor.userId, db);
  const before = await getMcpAccessBlock(userId, db as unknown as McpBlockDatabase);
  const block = await blockMcpAccess(userId, reason ?? null, context.actor.userId, db);
  await auditChange(context.actor, 'mcp.access.block', userId, before ? { blocked: true } : null, { blocked: true });
  return ok(status(userId, block), PRIVATE);
});

export const DELETE = withHandler(async (request) => {
  mutationRequest(request);
  const context = await centralContext(request);
  const { userId } = await parseBody(UnblockInput, request, { maxBytes: 1_024 });
  const db = supabaseService();
  await mutationLimit(context.actor.userId, db);
  const before = await getMcpAccessBlock(userId, db as unknown as McpBlockDatabase);
  await unblockMcpAccess(userId, db);
  await auditChange(context.actor, 'mcp.access.unblock', userId, { blocked: before !== null }, { blocked: false });
  return ok(status(userId, null), PRIVATE);
});
