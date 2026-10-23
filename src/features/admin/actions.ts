"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api";
import { ADMIN_SCOPE_COOKIE, scopeKey } from "@/lib/admin-scope";
import { getAdminContext } from "./context";
export async function enterSchoolWorkspace(form: FormData) {
  const context = await getAdminContext();
  const key = String(form.get("scope") ?? "");
  if (!context.options.some((option) => scopeKey(option.scope) === key))
    throw new ApiError(403, "FORBIDDEN", "Scope not available");
  (await cookies()).set(ADMIN_SCOPE_COOKIE, key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  const destination = String(form.get("destination") ?? "/admin");
  redirect(
    [
      "/admin",
      "/admin/users",
      "/studio/library",
      "/studio/analytics",
      "/admin/roles",
    ].includes(destination)
      ? destination
      : "/admin",
  );
}
