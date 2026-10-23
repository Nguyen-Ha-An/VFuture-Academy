import { getLocale } from "next-intl/server";
import { forbidden } from "next/navigation";
import { resolveCourseTitle, resolveItemTitle, versionTitles } from "@/features/grading/titles";
import { GradingOperations } from "@/features/instructor-grading/GradingOperations";
import type { QueueTitles } from "@/features/instructor-grading/SubmissionsWorkspace";
import { instructorBranchScope, loadInstructorPageData } from "@/features/instructor-grading/server-data";
import { gradingPageContext } from "@/features/workspace/context";
import { can } from "@/lib/permissions";

export default async function GradingQueuePage() {
  const [context, locale] = await Promise.all([gradingPageContext(), getLocale()]);
  if (!can(context.actor, "submission.grade", context.scope)) forbidden();
  const scope = context.scope.kind === "branch"
    ? { global: false, branchIds: [context.scope.branchId] }
    : instructorBranchScope(context.actor, "submission.grade");
  if (!scope.global && scope.branchIds.length === 0) forbidden();
  const { branches, metadata } = await loadInstructorPageData(locale, scope);
  // Only assignment and exam items are ever labelled here; lessons never reach the client.
  const gradedItems = [...metadata.assignments, ...metadata.exams];
  const titles = await queueTitles(
    gradedItems.map((entry) => entry.courseVersionId),
    new Set(gradedItems.map((entry) => `${entry.courseVersionId.toLowerCase()}:${entry.itemId}`)),
    locale === "en" ? "en" : "vi",
  );
  return <GradingOperations branches={branches} courses={metadata.courses} assignments={metadata.assignments} exams={metadata.exams} gradingBranchIds={scope.global ? null : scope.branchIds} titles={titles} />;
}

/** Localized course and item titles per course version (titles.ts), so queue rows never show raw ids. */
async function queueTitles(versionIds: string[], gradedItems: ReadonlySet<string>, locale: "vi" | "en"): Promise<QueueTitles> {
  const map = await versionTitles(versionIds);
  return Object.fromEntries([...map].map(([versionId, entry]) => [versionId, {
    courseTitle: resolveCourseTitle(map, versionId, locale, entry.courseId),
    items: Object.fromEntries([...entry.items.keys()]
      .filter((itemId) => gradedItems.has(`${versionId.toLowerCase()}:${itemId}`))
      .map((itemId) => [itemId, resolveItemTitle(map, versionId, itemId, locale)])),
  }]));
}
