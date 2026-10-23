import "server-only";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import type { Actor } from "@/lib/permissions";
import { supabaseService } from "@/lib/supabase/server";
import { saveWorkspace } from "@/features/studio/drafts";
import { session as assignmentSession } from "@/features/submissions/service";
import { findNotebookAssignment, type NotebookContext } from "./access";
import { NotebookAssignmentSchema } from "./contracts";
import {
  readArtifact,
  assertArtifactTarget,
  signedArtifact,
  notebookDependencies,
} from "./storage";
import { validateRevision } from "./upload-contract";

type Database = ReturnType<typeof supabaseService>;
export async function notebookSession(
  actor: Actor,
  context: NotebookContext,
  db: Database = supabaseService(),
) {
  const config = context.notebook;
  const dependencies = config
    ? await notebookDependencies(context, config, db)
    : { template: null, datasets: [] };
  let draft: {
    revision: number;
    artifact: Awaited<ReturnType<typeof signedArtifact>>;
  } | null = null;
  if (!context.studio) {
    let query = db
      .from("notebook_drafts")
      .select("revision,artifact_id")
      .eq("user_id", actor.userId)
      .eq("course_version_id", context.courseVersionId)
      .eq("item_id", context.itemId);
    query =
      context.blockId === null
        ? query.is("block_id", null)
        : query.eq("block_id", context.blockId);
    const result = await query.maybeSingle();
    if (result.error) throw new Error("Unable to read notebook draft");
    if (result.data) {
      const row = await readArtifact(result.data.artifact_id, db);
      assertArtifactTarget(row, actor, context);
      if (row.template_checksum !== config?.templateChecksum)
        throw new ApiError(
          409,
          "NOTEBOOK_TEMPLATE_CONFLICT",
          "Draft belongs to a different template revision",
        );
      draft = {
        revision: result.data.revision,
        artifact: await signedArtifact(row, db),
      };
    }
  }
  return {
    userId: actor.userId,
    courseId: context.courseId,
    itemId: context.itemId,
    blockId: context.blockId,
    courseVersionId: context.courseVersionId,
    config,
    ...dependencies,
    draft,
    studioRevision: context.draft?.updatedAt ?? null,
    assignment: context.studio ? null : await assignmentSession(actor, context),
  };
}
export async function saveNotebookDraft(
  actor: Actor,
  context: NotebookContext,
  value: unknown,
  db: Database = supabaseService(),
) {
  const input = z
    .object({ artifactId: z.string().uuid(), expectedRevision: z.number() })
    .strict()
    .parse(value);
  const expected = validateRevision(input.expectedRevision);
  if (context.studio || !context.courseVersionId)
    throw new ApiError(
      403,
      "NOTEBOOK_DRAFT_SCOPE",
      "A learner enrollment is required",
    );
  const artifact = await readArtifact(input.artifactId, db);
  assertArtifactTarget(artifact, actor, context);
  if (
    artifact.purpose !== "draft" ||
    artifact.status !== "ready" ||
    artifact.template_checksum !== context.notebook?.templateChecksum
  )
    throw new ApiError(
      422,
      "NOTEBOOK_DRAFT_INVALID",
      "Draft does not match this assignment",
    );
  const { data, error } = await db.rpc("save_notebook_draft", {
    p_user_id: actor.userId,
    p_course_version_id: context.courseVersionId,
    p_item_id: context.itemId,
    p_block_id: context.blockId,
    p_artifact_id: artifact.id,
    p_expected_revision: expected,
  });
  if (error) throw new Error("Unable to save notebook draft");
  if (data?.conflict)
    throw new ApiError(
      409,
      "NOTEBOOK_DRAFT_CONFLICT",
      "This notebook was saved in another tab. Download your copy before loading the newer version.",
    );
  return data as { revision: number; artifactId: string; updatedAt: string };
}
export async function saveStudioNotebook(
  actor: Actor,
  context: NotebookContext,
  value: unknown,
  expectedRevision: string | null,
) {
  if (!context.studio || !context.draft)
    throw new ApiError(
      403,
      "NOTEBOOK_STUDIO_SCOPE",
      "A Studio workspace is required",
    );
  if (!expectedRevision || expectedRevision !== context.draft.updatedAt)
    throw new ApiError(
      409,
      "DRAFT_CONFLICT",
      "Course draft changed. Reload before saving.",
    );
  const config = NotebookAssignmentSchema.parse(value);
  await notebookDependencies(context, config);
  const item = structuredClone(context.draft.items[context.itemId]);
  const assignment = findNotebookAssignment(item, context.blockId);
  if (!assignment)
    throw new ApiError(404, "NOTEBOOK_NOT_FOUND", "Assignment is unavailable");
  assignment.notebook = config;
  const saved = await saveWorkspace(
    context.courseId,
    {
      manifest: context.draft.manifest,
      items: { ...context.draft.items, [context.itemId]: item },
    },
    actor,
    expectedRevision,
  );
  return { revision: saved.updatedAt, config };
}
