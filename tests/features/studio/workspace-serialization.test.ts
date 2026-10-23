import { describe, expect, it } from "vitest";

import { serializableWorkspaceDraft } from "@/features/studio/workspace-serialization";

describe("workspace server boundary", () => {
  it("normalizes the null-prototype item map returned by getDraft", () => {
    const items = Object.create(null) as Record<string, unknown>;
    items["lesson-1"] = { id: "lesson-1", kind: "lesson" };

    const normalized = serializableWorkspaceDraft({
      id: "draft-1",
      courseId: "course-1",
      manifest: { id: "course-1", kind: "course" },
      items,
      baseVersionId: null,
      checklist: {},
      updatedAt: null,
    });

    expect(Object.getPrototypeOf(normalized.items)).toBe(Object.prototype);
    expect(normalized.items).toEqual({ "lesson-1": { id: "lesson-1", kind: "lesson" } });
  });
});
