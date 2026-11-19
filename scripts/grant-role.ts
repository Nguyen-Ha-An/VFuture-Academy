import { z } from 'zod';
import { academyBackend } from '../src/lib/identity/provider';
import { createServiceClient } from '../src/lib/supabase/service-client';
import { loadEnvironment } from './load-env';

const roleSchema = z.enum(['contributor', 'editor', 'instructor', 'branch_lead', 'admin', 'central_admin', 'central_reviewer', 'central_editor', 'school_admin', 'school_editor', 'teacher', 'member']);

function definitionFor(role: z.infer<typeof roleSchema>, branchId?: string): string {
  const mapped = role === 'admin' ? (branchId ? 'school_admin' : 'central_admin')
    : role === 'editor' ? 'central_editor'
    : role === 'instructor' ? 'teacher'
    : role === 'branch_lead' ? 'school_admin' : role;
  if (mapped === 'contributor') throw new Error('Create a resource-only custom role in Admin instead of granting a legacy contributor.');
  if (mapped.startsWith('central_') ? Boolean(branchId) : !branchId) throw new Error('Central roles require no branch; school roles require a branch ID.');
  return mapped;
}
const branchSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const grantSchema = z.object({
  userId: z.string().uuid().toLowerCase(),
  email: z.string().email(),
  role: roleSchema,
  branchId: branchSchema.optional(),
});
const serviceEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export function parseGrantRoleArguments(args: string[]) {
  const [userId, email, role, branchId] = args;
  const parsed = grantSchema.safeParse({ userId, email, role, branchId });
  if (args.length > 4 || !parsed.success) throw new Error('Usage: npm run grant-role -- <verified-user-id> <email> <role> [branchId]');
  return parsed.data;
}

function serviceFromEnvironment() {
  if (academyBackend() !== 'supabase') throw new Error('This operator command requires the Supabase identity backend.');
  const environment = serviceEnvironmentSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!environment.success) throw new Error('Service configuration is missing or invalid.');
  return createServiceClient(environment.data.NEXT_PUBLIC_SUPABASE_URL, environment.data.SUPABASE_SERVICE_ROLE_KEY);
}

export async function grantRole({ userId, email, role, branchId }: z.infer<typeof grantSchema>, service = serviceFromEnvironment()) {
  const roleDefinitionId = definitionFor(role, branchId);
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error) throw new Error('Unable to look up the requested account.', { cause: error });
  const user = data.user;
  if (!user || user.id !== userId || user.email?.toLowerCase() !== email.toLowerCase()
    || !user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at))) {
    throw new Error('The user ID and verified email must match the approved account.');
  }
  if (branchId) {
    const { error: membershipError } = await service.from('branch_memberships')
      .upsert({ user_id: userId, branch_id: branchId, status: 'active' }, { onConflict: 'user_id,branch_id', ignoreDuplicates: true });
    if (membershipError) throw new Error('Unable to create the requested school membership.', { cause: membershipError });
  }
  const { error: roleError } = await service.from('role_assignments')
    .upsert({ user_id: userId, role_definition_id: roleDefinitionId, branch_id: branchId ?? null }, { onConflict: 'user_id,role_definition_id,branch_id' });
  if (roleError) throw new Error('Unable to grant the requested role.', { cause: roleError });
}

async function main(args: string[]) {
  const grant = parseGrantRoleArguments(args);
  loadEnvironment();
  await grantRole(grant);
  console.log('Role granted.');
}

void (async () => {
  if (process.argv[1]?.endsWith('grant-role.ts')) {
    try {
      await main(process.argv.slice(2));
    } catch (error) {
      console.error('Role grant error:', error);
      console.error('Role grant failed. Check the arguments and service configuration.');
      process.exitCode = 1;
    }
  }
})();
