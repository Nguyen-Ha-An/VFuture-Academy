import { z } from "zod";
import { ApiError, withHandler } from "@/lib/api";
import { getActor } from "@/lib/permissions";
import { readSubmissionNotebook } from "@/features/notebooks/submission-read";
export const GET = withHandler(async (_request, context) => {
  const actor = await getActor();
  if (!actor)
    throw new ApiError(401, "UNAUTHENTICATED", "Sign in to view this notebook");
  const { submissionId } = await (
    context as { params: Promise<{ submissionId: string }> }
  ).params;
  return readSubmissionNotebook(actor, z.string().uuid().parse(submissionId));
});
