import { getLocale } from "next-intl/server";
import { gradingWorkbenchHeader } from "@/features/grading/detail";
import { GradingWorkbench } from "@/features/instructor-grading/GradingWorkbench";
import { gradingPageContext } from "@/features/workspace/context";
import { scopeKey } from "@/lib/admin-scope";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function GradingAssignmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<SearchParams> }) {
  const [{ id }, context, locale, search] = await Promise.all([params, gradingPageContext(), getLocale(), searchParams ?? Promise.resolve({} as SearchParams)]);
  const workbenchLocale = locale === "vi" ? "vi" : "en";
  // Titles come from the server; "Next in queue" streams in as a promise so it never blocks the
  // first render; the pinned detail still loads in the client.
  const header = await gradingWorkbenchHeader({
    kind: "assignments", id, actor: context.actor, locale: workbenchLocale, search,
    scopeBranchId: context.scope.kind === "branch" ? context.scope.branchId : null,
  });
  return <GradingWorkbench kind="assignments" id={id} actorId={context.actor.userId} scope={scopeKey(context.scope)} locale={workbenchLocale} canRelease={false} titles={header.titles} nextHref={header.nextHref} />;
}
