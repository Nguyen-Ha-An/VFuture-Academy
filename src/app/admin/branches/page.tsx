import { BranchesManager } from "@/features/admin/components/BranchesManager";
import { adminPageContext } from "@/features/admin/context";
import { schoolsDirectory } from "./data";

export default async function BranchesPage() {
  const context = await adminPageContext("branch.read");
  const canReadReports = context.permissions.includes(
    context.scope.kind === "central" ? "report.global.read" : "report.branch.read",
  );
  const { branches, reports } = await schoolsDirectory(context, { withReports: canReadReports });
  return (
    <BranchesManager
      initialBranches={branches}
      reports={reports.state === "ready" ? reports.rows : reports.state === "unavailable" ? "unavailable" : undefined}
      canManage={context.scope.kind === "central" && context.permissions.includes("branch.manage")}
    />
  );
}
