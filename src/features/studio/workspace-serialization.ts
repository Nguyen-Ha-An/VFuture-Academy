import type { CourseDraft } from "./drafts";

export function serializableWorkspaceDraft(draft: CourseDraft): CourseDraft {
  return { ...draft, items: Object.fromEntries(Object.entries(draft.items)) };
}
