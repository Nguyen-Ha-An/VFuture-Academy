import "server-only";
import type { Actor } from "@/lib/permissions";
import { supabaseService } from "@/lib/supabase/server";
import { ApiError } from "@/lib/api";
import { canGradeSubmissionBranch } from "@/features/submissions/permissions";
import { readArtifact, signedArtifact } from "./storage";
import { assertActiveNotebookActor } from "./actor-precondition";

export async function readSubmissionNotebook(
  actor: Actor,
  submissionId: string,
  db: ReturnType<typeof supabaseService> = supabaseService(),
) {
  assertActiveNotebookActor(actor);
  const { data: submission, error } = await db
    .from("assignment_submissions")
    .select(
      "id,user_id,course_version_id,item_id,block_id,payload,branch_id,branch_scope_known",
    )
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new Error("Unable to read notebook submission");
  const unavailable = () =>
    new ApiError(
      404,
      "NOTEBOOK_SUBMISSION_NOT_FOUND",
      "Notebook submission is unavailable",
    );
  if (!submission) throw unavailable();
  const branch =
    submission.branch_scope_known === true &&
    typeof submission.branch_id === "string"
      ? submission.branch_id
      : null;
  if (
    submission.user_id !== actor.userId &&
    !canGradeSubmissionBranch(actor, branch)
  )
    throw unavailable();
  const reference = submission.payload?.notebook;
  if (!reference || typeof reference.assetId !== "string") throw unavailable();
  const row = await readArtifact(reference.assetId, db);
  if (
    row.owner_id !== submission.user_id ||
    row.course_version_id !== submission.course_version_id ||
    row.item_id !== submission.item_id ||
    row.block_id !== submission.block_id ||
    row.purpose !== "submission" ||
    row.checksum !== reference.checksum
  )
    throw unavailable();
  return signedArtifact(row, db);
}
