import { staffShellVariant } from "@/features/workspace/presentation";
import { AdminSessionGuard } from "@/features/admin/components/AdminSessionGuard";
import { StudioShell } from "@/components/StudioShell";
import { readStaffChrome } from "@/features/staff-ui/chrome.server";
import { preloadStaffFonts } from "@/features/staff-ui/fonts";
import { StaffWorkspaceShell } from "@/features/staff-ui/ui/StaffWorkspaceShell";
import { studioPageContext } from "@/features/workspace/context";
import { scopeKey } from "@/lib/admin-scope";
import { routes } from "@/lib/routes";

export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const variant = staffShellVariant("studio");
  // Chrome (theme, rail, identity) is read only for the Catmin shell, alongside the context.
  const [context, chrome] = await Promise.all([
    studioPageContext(),
    variant === "catmin" ? readStaffChrome() : null,
  ]);
  if (chrome) {
    preloadStaffFonts();
    return (
      <AdminSessionGuard
        key={context.actor.userId}
        actorId={context.actor.userId}
        destination={routes.studio.dashboard()}
      >
        <StaffWorkspaceShell
          key={`${context.actor.userId}:${scopeKey(context.scope)}`}
          workspace="studio"
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
      destination={routes.studio.dashboard()}
    >
      <StudioShell
        redesigned={variant === "redesigned"}
        key={`${context.actor.userId}:${scopeKey(context.scope)}`}
        permissions={context.permissions}
        scopeOptions={context.options}
        activeScope={context.scope}
        entries={context.entries}
      >
        {children}
      </StudioShell>
    </AdminSessionGuard>
  );
}
