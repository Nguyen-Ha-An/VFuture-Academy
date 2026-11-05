import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { adminPageContext, adminWorkspacePageContext } from "@/features/admin/context";
import { adminDashboard } from "@/features/admin/dashboard";
import { AdminOverviewView } from "@/features/admin/ui/AdminOverviewView";
import { buildAdminOverviewView } from "@/features/admin/ui/overview/view-model";
import { firstAdminDestination } from "@/lib/admin-navigation";
import { routes } from "@/lib/routes";
import { scopeKey } from "@/lib/admin-scope";

export default async function AdminPage() {
  // The overview itself still needs `admin.access`. An operator admitted only
  // by a narrow destination is sent to that destination instead of a dead end.
  const workspace = await adminWorkspacePageContext();
  if (!workspace.permissions.includes("admin.access")) {
    const destination = firstAdminDestination(workspace.permissions);
    if (destination && destination !== routes.admin.dashboard()) redirect(destination);
  }
  const context = await adminPageContext();
  const [data, t, locale] = await Promise.all([
    adminDashboard(context),
    getTranslations("centralAdmin"),
    getLocale(),
  ]);
  // Keep the authorized scope visible when the phone's navigation drawer is closed.
  const activeScope = context.options.find((option) => scopeKey(option.scope) === scopeKey(context.scope));
  const eyebrow = context.scope.kind === "central" ? t("central") : activeScope?.label ?? t("scope");
  // Cross-workspace links (Studio reviews, grading queue) come from every authorized
  // scope, never from the permissions the Administration workspace filtered down to.
  return <AdminOverviewView {...buildAdminOverviewView({
    data,
    permissions: context.permissions,
    entries: context.entries,
    locale,
    eyebrow,
    title: t("overview"),
    description: t("overviewDescription"),
  })} />;
}
