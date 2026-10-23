import { z } from "zod";
import { isPermission } from "@/lib/authorization";
const branch = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const role = z.string().min(1).max(100);
const status = z.enum(["active", "suspended"]);
export const MemberQuerySchema = z
  .object({
    query: z.string().trim().max(160).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
    status: status.optional(),
    roleId: role.optional(),
    kind: z.enum(["learner", "staff"]).optional(),
  })
  .strict();
export const MemberMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("identity"),
      displayName: z.string().trim().min(1).max(160),
    })
    .strict(),
  z
    .object({ action: z.literal("transfer"), branchId: branch.nullable() })
    .strict(),
  z.object({ action: z.literal("account-status"), status }).strict(),
  z
    .object({
      action: z.literal("membership-status"),
      branchId: branch,
      status,
    })
    .strict(),
  z
    .object({
      action: z.literal("role"),
      roleId: role,
      branchId: branch.nullable(),
      enabled: z.boolean(),
    })
    .strict(),
]);
export const RoleDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1000).default(""),
    scopeKind: z.enum(["central", "branch"]),
    permissions: z.array(z.string().refine(isPermission)).max(100),
    grantableBySchool: z.boolean(),
  })
  .strict();
export const RoleUpdateSchema = RoleDefinitionSchema.extend({
  version: z.number().int().min(1),
});
export const InvitationSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase().trim()),
    branchId: branch,
    roleId: role.nullable(),
  })
  .strict();
export async function routeParam(
  context: unknown,
  name: string,
): Promise<string> {
  const params = await (context as { params: Promise<Record<string, string>> })
    .params;
  return name === "roleId"
    ? role.parse(params[name])
    : z.uuid().parse(params[name]);
}
