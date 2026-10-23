import "server-only";
import { getItemPayload } from "@/features/progress/service";
import { getDraft, type CourseDraft } from "@/features/studio/drafts";
import { NotebookAssignmentSchema, type NotebookAssignment } from "./contracts";
import type { NotebookLocator } from "./upload-contract";
import { ApiError } from "@/lib/api";
import { can, type Actor } from "@/lib/permissions";
import { supabaseService } from "@/lib/supabase/server";

export type NotebookContext = NotebookLocator & {
  courseVersionId: string | null;
  notebook: NotebookAssignment | null;
  studio: boolean;
  draft?: CourseDraft;
};
export function findNotebookAssignment(
  value: unknown,
  blockId: string | null,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (blockId === null) return obj.kind === "assignment" ? obj : null;
  if (obj.type === "assignment" && obj.id === blockId) return obj;
  if (obj.kind === "exam") return null;
  for (const child of Object.values(obj)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findNotebookAssignment(item, blockId);
        if (found) return found;
      }
    } else if (child && typeof child === "object") {
      const found = findNotebookAssignment(child, blockId);
      if (found) return found;
    }
  }
  return null;
}
/** Ownership is read from the course, never from caller-selected scope or role names. */
export async function authorizeStudioNotebook(actor: Actor, courseId: string) {
  const { data, error } = await supabaseService()
    .from("courses")
    .select("ownership_kind,owner_branch_id")
    .eq("id", courseId)
    .maybeSingle();
  if (error) throw new Error("Unable to read course ownership");
  if (!data)
    throw new ApiError(404, "COURSE_NOT_FOUND", "Course is unavailable");
  const scope =
    data.ownership_kind === "central"
      ? { kind: "central" as const }
      : data.ownership_kind === "branch" &&
          typeof data.owner_branch_id === "string"
        ? { kind: "branch" as const, branchId: data.owner_branch_id }
        : null;
  if (!scope || !can(actor, "course.edit", scope))
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Course editing permission is required in this scope",
    );
}
export async function loadNotebookContext(
  actor: Actor,
  locator: NotebookLocator,
  studio = false,
): Promise<NotebookContext> {
  let source: unknown;
  let draft: CourseDraft | undefined;
  let version: string | null = null;
  if (studio) {
    await authorizeStudioNotebook(actor, locator.courseId);
    draft = await getDraft(locator.courseId);
    source = draft.items[locator.itemId];
  } else {
    const payload = await getItemPayload(
      actor,
      locator.courseId,
      locator.itemId,
      "vi",
    );
    version = payload.courseVersionId;
    source = payload.item;
  }
  const assignment = findNotebookAssignment(source, locator.blockId);
  if (!assignment || (!studio && !assignment.notebook))
    throw new ApiError(
      404,
      "NOTEBOOK_NOT_FOUND",
      "Notebook assignment is unavailable",
    );
  return {
    ...locator,
    courseVersionId: version,
    notebook: assignment.notebook
      ? NotebookAssignmentSchema.parse(assignment.notebook)
      : null,
    studio,
    ...(draft ? { draft } : {}),
  };
}
