import { getLocale } from "next-intl/server";
import { forbidden } from "next/navigation";
import { AssessmentsWorkspace } from "@/features/instructor-grading/AssessmentsWorkspace";
import { instructorBranchScope, loadInstructorPageData } from "@/features/instructor-grading/server-data";
import { gradingPageContext } from "@/features/workspace/context";
import { can } from "@/lib/permissions";

export default async function AssessmentsPage() {
  const [context, locale] = await Promise.all([gradingPageContext(), getLocale()]);
  const canRelease = can(context.actor, "exam.release", context.scope);
  const canGrade = can(context.actor, "submission.grade", context.scope);
  if (!canRelease && !canGrade) forbidden();
  const releaseScope = context.scope.kind === "branch"
    ? { global: false, branchIds: canRelease ? [context.scope.branchId] : [] }
    : instructorBranchScope(context.actor, "exam.release");
  const gradingScope = context.scope.kind === "branch"
    ? { global: false, branchIds: canGrade ? [context.scope.branchId] : [] }
    : instructorBranchScope(context.actor, "submission.grade");
  const readableScope = releaseScope.global || gradingScope.global
    ? { global: true, branchIds: [] }
    : { global: false, branchIds: [...new Set([...releaseScope.branchIds, ...gradingScope.branchIds])] };
  const { branches, metadata } = await loadInstructorPageData(locale, readableScope);
  return <AssessmentsWorkspace assignments={canGrade?metadata.assignments:[]} canGrade={canGrade} branches={branches} courses={metadata.courses} exams={metadata.exams} canRelease={canRelease} gradingBranchIds={gradingScope.global ? null : gradingScope.branchIds} releaseBranchIds={releaseScope.global ? null : releaseScope.branchIds} />;
}
