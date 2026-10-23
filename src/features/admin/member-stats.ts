import "server-only";
import { supabaseService } from "@/lib/supabase/server";
import type { AdminContext } from "./context";
import { managementRead } from "./management";

/**
 * KPI row on /admin/users. Each value follows the staff honest-data rules:
 * - key absent → the viewer lacks the permission, so the card is hidden;
 * - `null` → the read failed, so the card says "Unavailable" (never 0);
 * - a number → a snapshot count for the current scope (snapshot counts never get deltas).
 * Every count uses the same definition as the matching directory filter, so a card can
 * link to that filtered list: learners = the "Learner" type filter, suspended = the
 * "Suspended" status filter, members = the admin home's member count.
 */
export type MemberStats = {
  members?: number | null;
  learners?: number | null;
  suspended?: number | null;
  pendingInvitations?: number | null;
};

type Database = ReturnType<typeof supabaseService>;
type CountResult = { count: number | null; error: unknown };
type RowsResult = { data: unknown; error: unknown; count?: number | null };

/** Suspended accounts are rare; past this many the branch-scope union is not computed. */
export const SUSPENDED_ACCOUNT_LIMIT = 1000;
const ID_BATCH_SIZE = 100;

function exactCount(result: CountResult): number {
  if (result.error || typeof result.count !== "number")
    throw new Error("Unable to count members");
  return result.count;
}

function rows(result: RowsResult): Record<string, unknown>[] {
  if (result.error || !Array.isArray(result.data))
    throw new Error("Unable to load members");
  return result.data as Record<string, unknown>[];
}

async function settle(read: () => Promise<number>): Promise<number | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

async function membersCount(context: AdminContext, database: Database) {
  // The dashboard operation owns the scoped member definition (primary school or membership).
  const result = await managementRead<{ members?: unknown }>(
    context,
    "dashboard",
    {},
    database,
  );
  if (typeof result.members !== "number")
    throw new Error("Unable to count members");
  return result.members;
}

async function learnersCount(context: AdminContext, database: Database) {
  // Same rule as the directory's "Learner" filter: a primary school inside the scope.
  const query = database
    .from("profiles")
    .select("id", { count: "exact", head: true });
  const scoped =
    context.scope.kind === "branch"
      ? query.eq("branch_id", context.scope.branchId)
      : query.not("branch_id", "is", null);
  return exactCount((await scoped) as CountResult);
}

async function suspendedCount(context: AdminContext, database: Database) {
  if (context.scope.kind === "central") {
    return exactCount(
      (await database
        .from("user_accounts")
        .select("user_id", { count: "exact", head: true })
        .eq("status", "suspended")) as CountResult,
    );
  }
  // Branch scope mirrors the "Suspended" filter: the school membership is suspended, or the
  // whole account is suspended for someone who belongs to this school.
  const branchId = context.scope.branchId;
  const suspendedMemberships = exactCount(
    (await database
      .from("branch_memberships")
      .select("user_id", { count: "exact", head: true })
      .eq("branch_id", branchId)
      .eq("status", "suspended")) as CountResult,
  );
  const accountsResult = (await database
    .from("user_accounts")
    .select("user_id", { count: "exact" })
    .eq("status", "suspended")
    .range(0, SUSPENDED_ACCOUNT_LIMIT - 1)) as RowsResult;
  const accountIds = rows(accountsResult)
    .map((row) => row.user_id)
    .filter((id): id is string => typeof id === "string");
  // A partial id list would undercount: say "Unavailable" instead.
  if (
    typeof accountsResult.count === "number" &&
    accountsResult.count > accountIds.length
  )
    throw new Error("Too many suspended accounts to count");
  let extra = 0;
  for (let index = 0; index < accountIds.length; index += ID_BATCH_SIZE) {
    const batch = accountIds.slice(index, index + ID_BATCH_SIZE);
    const [profiles, memberships] = await Promise.all([
      database.from("profiles").select("id, branch_id").in("id", batch),
      database
        .from("branch_memberships")
        .select("user_id, status")
        .eq("branch_id", branchId)
        .in("user_id", batch),
    ]);
    const primaryHere = new Set(
      rows(profiles as RowsResult)
        .filter((row) => row.branch_id === branchId)
        .map((row) => row.id),
    );
    const membershipHere = new Map(
      rows(memberships as RowsResult).map((row) => [row.user_id, row.status]),
    );
    for (const id of batch) {
      const inScope = primaryHere.has(id) || membershipHere.has(id);
      // Already counted through the suspended membership above.
      if (inScope && membershipHere.get(id) !== "suspended") extra += 1;
    }
  }
  return suspendedMemberships + extra;
}

async function pendingInvitationsCount(
  context: AdminContext,
  database: Database,
) {
  // Same derivation as admin_invitation_json: not accepted, not revoked, not expired.
  let query = database
    .from("admin_invitations")
    .select("id", { count: "exact", head: true })
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString());
  if (context.scope.kind === "branch")
    query = query.eq("branch_id", context.scope.branchId);
  return exactCount((await query) as CountResult);
}

/** Member KPIs for the active admin scope. Never throws; see MemberStats for the value rules. */
export async function memberStats(
  context: AdminContext,
  database?: Database,
): Promise<MemberStats> {
  const canReadMembers = context.permissions.includes("member.read");
  const canManageInvites = context.permissions.includes("membership.manage");
  if (!canReadMembers && !canManageInvites) return {};
  let client: Database;
  try {
    client = database ?? supabaseService();
  } catch {
    return {
      ...(canReadMembers ? { members: null, learners: null, suspended: null } : {}),
      ...(canManageInvites ? { pendingInvitations: null } : {}),
    };
  }
  const [members, learners, suspended, pendingInvitations] = await Promise.all([
    canReadMembers ? settle(() => membersCount(context, client)) : undefined,
    canReadMembers ? settle(() => learnersCount(context, client)) : undefined,
    canReadMembers ? settle(() => suspendedCount(context, client)) : undefined,
    canManageInvites
      ? settle(() => pendingInvitationsCount(context, client))
      : undefined,
  ]);
  const stats: MemberStats = {};
  if (members !== undefined) stats.members = members;
  if (learners !== undefined) stats.learners = learners;
  if (suspended !== undefined) stats.suspended = suspended;
  if (pendingInvitations !== undefined)
    stats.pendingInvitations = pendingInvitations;
  return stats;
}
