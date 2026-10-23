import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { adminPageContext, adminWorkspacePageContext } from "@/features/admin/context";
import { adminDashboard } from "@/features/admin/dashboard";
import { AdminOverviewView } from "@/features/admin/ui/AdminOverviewView";
import { buildAdminOverviewView } from "@/features/admin/ui/overview/view-model";
import { firstAdminDestination } from "@/lib/admin-navigation";
import { routes } from "@/lib/routes";

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
  // No eyebrow: the scope switcher in the sidebar already names the scope.
  // Cross-workspace links (Studio reviews, grading queue) come from every authorized
  // scope, never from the permissions the Administration workspace filtered down to.
  return <AdminOverviewView {...buildAdminOverviewView({
    data,
    permissions: context.permissions,
    entries: context.entries,
    locale,
    title: t("overview"),
    description: t("overviewDescription"),
  })} />;
}
