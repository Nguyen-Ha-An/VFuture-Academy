import "server-only";
import { z } from "zod";
import { withHandler, ApiError } from "@/lib/api";
import { requireApiUser } from "@/lib/auth";
import { getActor } from "@/lib/permissions";
import { readJsonBodyLimited } from "@/lib/body-limit";
import {
  enforceRateLimit,
  RATE_LIMITS,
  userRateLimitKey,
} from "@/lib/rate-limit";
import { supabaseService } from "@/lib/supabase/server";
import { NotebookLocatorSchema } from "./upload-contract";
import { loadNotebookContext } from "./access";
import {
  notebookSession,
  saveNotebookDraft,
  saveStudioNotebook,
} from "./service";
import { beginNotebookUpload, finalizeNotebookUpload } from "./storage";
import {
  assertActiveNotebookActor,
  assertNotebookActor,
} from "./actor-precondition";

export const NOTEBOOK_ACTION_RATE_LIMITS = {
  upload: { limit: 30, windowSeconds: 60 },
  finalize: { limit: 30, windowSeconds: 60 },
  draft: { limit: 30, windowSeconds: 60 },
  config: { limit: 10, windowSeconds: 60 },
} as const;

export function notebookHandler(
  action: "session" | "upload" | "finalize" | "draft" | "config",
  studio = false,
) {
  return withHandler(async (request) => {
    const user = await requireApiUser();
    if (action !== "session") assertNotebookActor(request, user.id);
    const actor = await getActor();
    if (!actor)
      throw new ApiError(401, "UNAUTHENTICATED", "Please sign in again");
    if (actor.userId !== user.id)
      throw new ApiError(
        401,
        "NOTEBOOK_ACTOR_CHANGED",
        "The signed-in account changed; reload the notebook",
      );
    assertActiveNotebookActor(actor);
    const search = new URL(request.url).searchParams;
    const locator = NotebookLocatorSchema.parse({
      courseId: search.get("courseId"),
      itemId: search.get("itemId"),
      blockId: search.get("blockId") || null,
    });
    const context = await loadNotebookContext(actor, locator, studio);
    if (action === "session") return notebookSession(actor, context);
    const database = supabaseService();
    await enforceRateLimit(
      database,
      userRateLimitKey("notebooks:mutation", actor.userId),
      RATE_LIMITS.progress,
      "Too many notebook saves; please try again shortly",
    );
    await enforceRateLimit(
      database,
      userRateLimitKey(`notebooks:${action}`, actor.userId),
      NOTEBOOK_ACTION_RATE_LIMITS[action],
      "Too many notebook saves; please try again shortly",
    );
    const body = await readJsonBodyLimited(request);
    if (action === "upload") return beginNotebookUpload(actor, context, body);
    if (action === "finalize")
      return finalizeNotebookUpload(
        actor,
        context,
        z.object({ id: z.string().uuid() }).strict().parse(body).id,
      );
    if (action === "draft") return saveNotebookDraft(actor, context, body);
    return saveStudioNotebook(
      actor,
      context,
      body,
      request.headers.get("if-match"),
    );
  });
}
