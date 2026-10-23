import "server-only";

import { ApiError } from "@/lib/api";
import type { Actor } from "@/lib/permissions";

export const NOTEBOOK_ACTOR_HEADER = "X-Notebook-Actor";

/** Prevents a stale notebook tab from mutating data after the browser cookie changes accounts. */
export function assertNotebookActor(
  request: Request,
  authenticatedUserId: string,
): void {
  const expected = request.headers.get(NOTEBOOK_ACTOR_HEADER)?.trim();
  if (!expected)
    throw new ApiError(
      428,
      "NOTEBOOK_ACTOR_REQUIRED",
      "Reload the notebook before saving",
    );
  if (expected !== authenticatedUserId)
    throw new ApiError(
      401,
      "NOTEBOOK_ACTOR_CHANGED",
      "The signed-in account changed; reload the notebook",
    );
}

/** Notebook bytes remain unavailable to suspended or unresolved persisted accounts. */
export function assertActiveNotebookActor(actor: Actor): void {
  if (
    actor.authorization?.source !== "database" ||
    actor.authorization.accountStatus !== "active"
  ) {
    throw new ApiError(
      403,
      "ACCOUNT_INACTIVE",
      "This account cannot access notebooks",
    );
  }
}
