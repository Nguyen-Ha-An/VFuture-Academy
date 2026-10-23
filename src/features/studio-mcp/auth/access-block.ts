import 'server-only';

import { ApiError } from '@/lib/api';

type BlockQueryResult = { data: unknown; error: unknown | null };
type BlockQuery = {
  select(columns: string): BlockQuery;
  eq(column: string, value: string): BlockQuery;
  maybeSingle(): PromiseLike<BlockQueryResult>;
};

/** The MCP facade and the server-side service client can both perform this read. */
export type McpBlockDatabase = {
  from(table: string): unknown;
};

export type McpAccessBlock = {
  userId: string;
  reason: string | null;
  blockedBy: string | null;
  blockedAt: string;
};

function lookupUnavailable(): ApiError {
  return new ApiError(503, 'MCP_ACCESS_UNAVAILABLE', 'MCP access status is unavailable');
}

async function lookup(db: McpBlockDatabase, userId: string, columns: string): Promise<unknown> {
  try {
    const { data, error } = await (db.from('studio_mcp_access_blocks') as BlockQuery)
      .select(columns).eq('user_id', userId).maybeSingle();
    if (error) throw lookupUnavailable();
    return data;
  } catch {
    throw lookupUnavailable();
  }
}

/** A confirmed empty result is the only unblocked state. No cache delays revocation. */
export async function isMcpAccessBlocked(userId: string, db: McpBlockDatabase): Promise<boolean> {
  const data = await lookup(db, userId, 'user_id');
  if (data === null) return false;
  if (typeof data !== 'object' || data === null || !('user_id' in data) || data.user_id !== userId) {
    throw lookupUnavailable();
  }
  return true;
}

/** Returns Central Admin metadata only; never expose this row through a user client. */
export async function getMcpAccessBlock(userId: string, db: McpBlockDatabase): Promise<McpAccessBlock | null> {
  const data = await lookup(db, userId, 'user_id, reason, blocked_by, blocked_at');
  if (data === null) return null;
  if (typeof data !== 'object' || data === null) throw lookupUnavailable();
  const row = data as Record<string, unknown>;
  if (row.user_id !== userId || typeof row.blocked_at !== 'string'
    || !(row.reason === null || typeof row.reason === 'string')
    || !(row.blocked_by === null || typeof row.blocked_by === 'string')) {
    throw lookupUnavailable();
  }
  return { userId, reason: row.reason, blockedBy: row.blocked_by, blockedAt: row.blocked_at };
}
