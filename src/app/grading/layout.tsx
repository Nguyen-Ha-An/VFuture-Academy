import { staffShellVariant } from "@/features/workspace/presentation";
import { AdminSessionGuard } from "@/features/admin/components/AdminSessionGuard";
import { GradingShell } from "@/components/GradingShell";
import { readStaffChrome } from "@/features/staff-ui/chrome.server";
import { preloadStaffFonts } from "@/features/staff-ui/fonts";
import { StaffWorkspaceShell } from "@/features/staff-ui/ui/StaffWorkspaceShell";
import { gradingPageContext } from "@/features/workspace/context";
import { scopeKey } from "@/lib/admin-scope";
import { routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

export default async function GradingLayout({ children }: { children: React.ReactNode }) {
  const variant = staffShellVariant("grading");
  // Chrome (theme, rail, identity) is read only for the Catmin shell, alongside the context.
  const [context, chrome] = await Promise.all([
    gradingPageContext(),
    variant === "catmin" ? readStaffChrome() : null,
  ]);
  if (chrome) {
    preloadStaffFonts();
    return (
      <AdminSessionGuard
        key={context.actor.userId}
        actorId={context.actor.userId}
        destination={routes.grading.dashboard()}
      >
        <StaffWorkspaceShell
          key={`${context.actor.userId}:${scopeKey(context.scope)}`}
          workspace="grading"
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
      destination={routes.grading.dashboard()}
    >
      <GradingShell
        redesigned={variant === "redesigned"}
        key={`${context.actor.userId}:${scopeKey(context.scope)}`}
        permissions={context.permissions}
        scopeOptions={context.options}
        activeScope={context.scope}
        entries={context.entries}
      >
        {children}
      </GradingShell>
    </AdminSessionGuard>
  );
}
