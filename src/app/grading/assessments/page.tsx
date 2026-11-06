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
  const empty = { branches: [], metadata: { courses: [], assignments: [], exams: [] } };
  const [grading, release] = await Promise.all([
    canGrade ? loadInstructorPageData(locale, gradingScope, context.actor, ['submission.grade']) : empty,
    canRelease ? loadInstructorPageData(locale, releaseScope, context.actor, ['exam.release']) : empty,
  ]);
  const branches = [...new Map([...grading.branches, ...release.branches].map((branch) => [branch.id, branch])).values()];
  const courses = [...new Map([...grading.metadata.courses, ...release.metadata.courses].map((course) => [course.id, course])).values()];
  const exams = [...new Map([...grading.metadata.exams, ...release.metadata.exams].map((exam) => [`${exam.courseVersionId}:${exam.itemId}`, exam])).values()];
  return <AssessmentsWorkspace assignments={grading.metadata.assignments} canGrade={canGrade} branches={branches} courses={courses} exams={exams} canRelease={canRelease} gradingBranchIds={gradingScope.global ? null : gradingScope.branchIds} releaseBranchIds={releaseScope.global ? null : releaseScope.branchIds} />;
}
