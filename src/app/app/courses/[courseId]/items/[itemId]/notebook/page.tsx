import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { getCourse } from "@/features/catalog/service";
import { FocusOutline } from "@/features/learner/ui/FocusOutline";
import { NotebookWorkspace } from "@/features/notebooks/ui/NotebookWorkspace";
import { notebookRuntimeUrl } from "@/features/notebooks/config";
import { NotebookLocatorSchema } from "@/features/notebooks/upload-contract";
import { ActivityFrame } from "@/features/workspace-ui/learner/activity/ActivityFrame";
import { pad2 } from "@/features/workspace-ui/learner/activity/status";
import { ApiError } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { routes } from "@/lib/routes";

export default async function NotebookPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; itemId: string }>;
  searchParams: Promise<{ blockId?: string }>;
}) {
  const [user, ids, query, localeValue, item, notebook, enums, activity] = await Promise.all([
    requireUser(),
    params,
    searchParams,
    getLocale(),
    getTranslations("learner.item"),
    getTranslations("notebook"),
    getTranslations("learner.enums"),
    getTranslations("bench.learner.activity"),
  ]);
  const parsed = NotebookLocatorSchema.safeParse({
    ...ids,
    blockId: query.blockId ?? null,
  });
  if (!parsed.success) notFound();
  const locale = localeValue === "en" ? "en" : "vi";
  let course: Awaited<ReturnType<typeof getCourse>>;
  try {
    // Course context for the frame: the title, the outline and the item's position.
    course = await getCourse({ userId: user.id, roles: [] }, ids.courseId, locale);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  if (!course.enrollment) redirect(routes.learner.course(ids.courseId));
  const items = course.outline.modules.flatMap((module) => module.items);
  const index = items.findIndex((outlineItem) => outlineItem.id === ids.itemId);
  if (index < 0) notFound();
  const current = items[index];
  const moduleIndex = course.outline.modules.findIndex((module) => module.items.some((outlineItem) => outlineItem.id === ids.itemId));
  const courseModule = course.outline.modules[moduleIndex];
  const progress = { completed: course.progress.completedItems, total: course.progress.totalItems };
  const itemHref = routes.learner.courseItem(ids.courseId, ids.itemId);
  const kind = enums(`kind.${current.type === "exam" || current.type === "assignment" ? current.type : "lesson"}`);
  return (
    <ActivityFrame
      kind="notebook"
      width="frame"
      course={{ title: course.meta.title || item("back"), href: routes.learner.course(ids.courseId) }}
      progress={progress}
      position={{ current: index + 1, total: items.length }}
      outline={<FocusOutline courseId={ids.courseId} itemId={ids.itemId} modules={course.outline.modules} courseTitle={course.meta.title} progress={progress} />}
      head={{
        kicker: <><span>{kind}</span><span aria-hidden="true"> · </span><span>{activity("notebook")}</span>{courseModule?.title ? <><span aria-hidden="true"> · </span><span>{courseModule.title}</span></> : null}</>,
        title: current.title,
        meta: [
          <><span aria-hidden="true">{moduleIndex >= 0 ? `M${pad2(moduleIndex + 1)} · ` : ""}{pad2(index + 1)} / {pad2(items.length)}</span><span className="sr-only">{item("step", { current: index + 1, total: items.length })}</span></>,
        ],
        status: course.progress.items[ids.itemId] ?? current.status,
      }}
      pager={{ label: activity("pager"), previous: { href: itemHref, title: current.title, kicker: notebook("back") } }}
    >
      <NotebookWorkspace
        locator={parsed.data}
        studio={false}
        runtimeUrl={notebookRuntimeUrl()}
      />
    </ActivityFrame>
  );
}
