import 'server-only';

import { ApiError } from '@/lib/api';
import type { supabaseService } from '@/lib/supabase/server';
import type { McpAccessBlock } from '@/features/studio-mcp/auth/access-block';

type ServiceDatabase = ReturnType<typeof supabaseService>;

function writeUnavailable(): ApiError {
  return new ApiError(503, 'MCP_ACCESS_UNAVAILABLE', 'MCP access update is unavailable');
}

function missingTarget(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  return value?.code === '23503'
    && typeof value.message === 'string'
    && value.message.includes('studio_mcp_access_blocks_user_id_fkey');
}

/** Writes only the application MCP block row; Supabase OAuth grants are untouched. */
export async function blockMcpAccess(
  userId: string,
  reason: string | null,
  actorId: string,
  db: ServiceDatabase,
): Promise<McpAccessBlock> {
  try {
    const { data, error } = await db.from('studio_mcp_access_blocks').upsert({
      user_id: userId,
      reason,
      blocked_by: actorId,
      blocked_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).select('user_id, reason, blocked_by, blocked_at').single();
    if (missingTarget(error)) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    if (error || !data || typeof data !== 'object') throw writeUnavailable();
    const row = data as Record<string, unknown>;
    if (row.user_id !== userId || typeof row.blocked_at !== 'string'
      || !(row.reason === null || typeof row.reason === 'string')
      || !(row.blocked_by === null || typeof row.blocked_by === 'string')) throw writeUnavailable();
    return { userId, reason: row.reason, blockedBy: row.blocked_by, blockedAt: row.blocked_at };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'USER_NOT_FOUND') throw error;
    throw writeUnavailable();
  }
}

export async function unblockMcpAccess(userId: string, db: ServiceDatabase): Promise<void> {
  try {
    const { error } = await db.from('studio_mcp_access_blocks').delete().eq('user_id', userId);
    if (error) throw writeUnavailable();
  } catch {
    throw writeUnavailable();
  }
}
