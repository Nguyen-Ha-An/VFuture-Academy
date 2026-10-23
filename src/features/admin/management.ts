import "server-only";
import { ApiError } from "@/lib/api";
import { supabaseService } from "@/lib/supabase/server";
import type { AdminContext } from "./context";

type DatabaseError = { code?: string; message?: string };
type Database = Pick<ReturnType<typeof supabaseService>, "rpc">;
export function managementDatabaseError(error: DatabaseError | null): void {
  if (!error) return;
  if (error.message?.includes("LAST_ADMIN"))
    throw new ApiError(
      409,
      "LAST_ADMIN",
      "The last active Central Admin must remain available",
    );
  if (error.message?.includes("SEARCH_RATE_LIMIT"))
    throw new ApiError(
      429,
      "RATE_LIMITED",
      "Too many searches. Please try again shortly.",
    );
  if (error.code === "42501")
    throw new ApiError(403, "FORBIDDEN", "Permission denied");
  if (error.code === "P0002")
    throw new ApiError(404, "NOT_FOUND", "Record not found");
  if (error.code === "40001")
    throw new ApiError(
      409,
      "REVISION_CONFLICT",
      "This record changed. Reload before saving.",
    );
  if (error.code === "23505")
    throw new ApiError(409, "ALREADY_EXISTS", "This record already exists");
  if (error.code === "23514" || error.code === "22023")
    throw new ApiError(400, "INVALID_OPERATION", "This change is not allowed");
  throw new Error("Unable to complete administration request");
}
async function call<T>(
  context: AdminContext,
  rpc: string,
  operation: string,
  input: unknown,
  database: Database,
): Promise<T> {
  const { data, error } = await database.rpc(rpc, {
    p_actor_id: context.actor.userId,
    p_scope_kind: context.scope.kind,
    p_branch_id:
      context.scope.kind === "branch" ? context.scope.branchId : null,
    p_operation: operation,
    p_input: input,
  });
  managementDatabaseError(error);
  if (data === null)
    throw new Error("Unable to complete administration request");
  return data as T;
}
export function managementRead<T>(
  context: AdminContext,
  operation: string,
  input: unknown = {},
  database = supabaseService(),
): Promise<T> {
  return call(context, "admin_management_read", operation, input, database);
}
export function managementWrite<T>(
  context: AdminContext,
  operation: string,
  input: unknown,
  database = supabaseService(),
): Promise<T> {
  return call(context, "admin_management_write", operation, input, database);
}
