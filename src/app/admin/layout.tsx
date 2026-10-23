import { staffShellVariant } from "@/features/workspace/presentation";
import { AdminSessionGuard } from "@/features/admin/components/AdminSessionGuard";
import { AdminShell } from "@/components/AdminShell";
import { adminWorkspacePageContext } from "@/features/admin/context";
import { readStaffChrome } from "@/features/staff-ui/chrome.server";
import { preloadStaffFonts } from "@/features/staff-ui/fonts";
import { StaffWorkspaceShell } from "@/features/staff-ui/ui/StaffWorkspaceShell";
import { scopeKey } from "@/lib/admin-scope";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const variant = staffShellVariant("admin");
  // Chrome (theme, rail, identity) is read only for the Catmin shell, alongside the context.
  const [context, chrome] = await Promise.all([
    adminWorkspacePageContext(),
    variant === "catmin" ? readStaffChrome() : null,
  ]);
  if (chrome) {
    preloadStaffFonts();
    return (
      <AdminSessionGuard
        key={context.actor.userId}
        actorId={context.actor.userId}
      >
        <StaffWorkspaceShell
          key={`${context.actor.userId}:${scopeKey(context.scope)}`}
          workspace="admin"
          chrome={chrome}
          permissions={context.permissions}
          scopeOptions={context.options}
          activeScope={context.scope}
          entries={context.entries}
        >
          {children}
        </StaffWorkspaceShell>
      </AdminSessionGuard>
    );
  }
  return (
    <AdminSessionGuard
      key={context.actor.userId}
      actorId={context.actor.userId}
    >
      <AdminShell
        redesigned={variant === "redesigned"}
        key={`${context.actor.userId}:${scopeKey(context.scope)}`}
        permissions={context.permissions}
        scopeOptions={context.options}
        activeScope={context.scope}
        entries={context.entries}
      >
        {children}
      </AdminShell>
    </AdminSessionGuard>
  );
}
