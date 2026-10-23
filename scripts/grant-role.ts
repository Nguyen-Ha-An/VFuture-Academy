import { z } from 'zod';
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
const serviceEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export function parseGrantRoleArguments(args: string[]) {
  const [email, rawRole, branchId] = args;
  const parsed = z.object({
    email: z.string().email(),
    role: roleSchema,
    branchId: branchSchema.optional(),
  }).safeParse({ email, role: rawRole, branchId });
  if (!parsed.success) throw new Error('Usage: npm run grant-role -- <email> <role> [branchId]');
  return parsed.data;
}

function serviceFromEnvironment() {
  const environment = serviceEnvironmentSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!environment.success) throw new Error('Service configuration is missing or invalid.');
  return createServiceClient(environment.data.NEXT_PUBLIC_SUPABASE_URL, environment.data.SUPABASE_SERVICE_ROLE_KEY);
}

export async function grantRoleByEmail(email: string, role: z.infer<typeof roleSchema>, branchId?: string, service = serviceFromEnvironment()) {
  const roleDefinitionId = definitionFor(role, branchId);
  const perPage = 1_000;
  let page = 1;

  while (true) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error('Unable to look up the requested account.', { cause: error });
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
    if (user) {
      const { error: confirmationError } = await service.auth.admin.updateUserById(user.id, { email_confirm: true });
      if (confirmationError) throw new Error('Unable to verify the requested account email.', { cause: confirmationError });
      if (branchId) {
        const { error: membershipError } = await service.from('branch_memberships')
          .upsert({ user_id: user.id, branch_id: branchId, status: 'active' }, { onConflict: 'user_id,branch_id' });
        if (membershipError) throw new Error('Unable to create the requested school membership.', { cause: membershipError });
      }
      const { error: roleError } = await service
        .from('role_assignments')
        .upsert({ user_id: user.id, role_definition_id: roleDefinitionId, branch_id: branchId ?? null }, { onConflict: 'user_id,role_definition_id,branch_id' });
      if (roleError) throw new Error('Unable to grant the requested role.', { cause: roleError });
      return;
    }
    if (data.users.length < perPage) break;
    page += 1;
  }

  throw new Error('No account exists for the requested email address.');
}

async function main(args: string[]) {
  const { email, role, branchId } = parseGrantRoleArguments(args);
  loadEnvironment();
  await grantRoleByEmail(email, role, branchId);
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
