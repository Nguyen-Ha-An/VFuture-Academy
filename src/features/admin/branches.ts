import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { ApiError } from '@/lib/api';
import { hasPermission, type Actor } from '@/lib/permissions';

export type Branch = {
  id: string;
  name: string;
  city: string | null;
  createdAt: string;
};

export type BranchInput = { id: string; name: string; city: string | null };
export type BranchUpdate = { name?: string; city?: string | null };

export const BranchIdSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export const BranchInputSchema = z.object({
  id: BranchIdSchema,
  name: z.string().trim().min(1).max(160),
  city: z.string().trim().min(1).max(160).nullable().default(null),
}).strict();

export const BranchUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  city: z.string().trim().min(1).max(160).nullable().optional(),
}).strict().refine((value) => value.name !== undefined || value.city !== undefined, {
  message: 'At least one branch field is required',
});

export interface BranchRepository {
  list(): Promise<Branch[]>;
  create(input: BranchInput, actorId: string): Promise<Branch>;
  update(id: string, input: BranchUpdate, actorId: string): Promise<Branch | null>;
}

type BranchRow = { id: string; name: string; city: string | null; created_at: string };

function toBranch(row: BranchRow): Branch {
  return { id: row.id, name: row.name, city: row.city, createdAt: row.created_at };
}

function assertGlobalManager(actor: Actor) {
  if (!hasPermission(actor, 'user.manage.global')) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
  }
}

export function createSupabaseBranchRepository(client: SupabaseClient): BranchRepository {
  return {
    async list() {
      const { data, error } = await client.from('branches').select('id, name, city, created_at').order('name');
      if (error) throw new Error('Unable to list branches');
      return ((data ?? []) as BranchRow[]).map(toBranch);
    },
    async create(input, actorId) {
      const { data, error } = await client.rpc('admin_apply_mutation', {
        p_operation: 'branch.create',
        p_actor_id: actorId,
        p_target_id: input.id,
        p_payload: { name: input.name, city: input.city },
      });
      if (error?.code === '23505') throw new ApiError(409, 'BRANCH_EXISTS', 'Branch already exists');
      if (error || !data) throw new Error('Unable to create branch');
      return toBranch(data as BranchRow);
    },
    async update(id, input, actorId) {
      const { data, error } = await client.rpc('admin_apply_mutation', {
        p_operation: 'branch.update',
        p_actor_id: actorId,
        p_target_id: id,
        p_payload: input,
      });
      if (error?.code === 'P0002') return null;
      if (error) throw new Error('Unable to update branch');
      return data ? toBranch(data as BranchRow) : null;
    },
  };
}

export function createBranchAdmin(dependencies: { repository: BranchRepository }) {
  const { repository } = dependencies;
  return {
    async list(actor: Actor) {
      assertGlobalManager(actor);
      return repository.list();
    },
    async create(actor: Actor, input: BranchInput) {
      assertGlobalManager(actor);
      return repository.create(input, actor.userId);
    },
    async update(actor: Actor, id: string, input: BranchUpdate) {
      assertGlobalManager(actor);
      const after = await repository.update(id, input, actor.userId);
      if (!after) throw new ApiError(404, 'BRANCH_NOT_FOUND', 'Branch not found');
      return after;
    },
  };
}
