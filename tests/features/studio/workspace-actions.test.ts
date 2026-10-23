import { describe, expect, it } from "vitest";

import type { ValidationReport } from "@/content-engine/diagnostics";
import { manifestWithImportedItem } from "@/features/studio/ui/ImportDialog";
import { isPublishReady } from "@/features/studio/publish-checklist";
import { previewMediaHref } from "@/features/studio/ui/PreviewPane";

const cleanReport: ValidationReport = {
  ok: true,
  errors: [],
  warnings: [],
  summary: {
    modules: 0,
    items: { lesson: 0, exam: 0, assignment: 0 },
    blocks: 0,
    questions: {},
    totalPoints: 0,
    languages: ["vi", "en"],
  },
};

describe("workspace action contracts", () => {
  it("adds a pasted item stub to an import module without duplicating an existing item", () => {
    const item = { id: "lesson-1", kind: "lesson", title: { en: "Lesson one" } };
    const original = { id: "course-1", kind: "course", modules: [{ id: "module-1", title: "Module", items: [{ id: "lesson-1", type: "lesson", title: "Old title", required: true }] }] };
    const first = manifestWithImportedItem(original, item, "module-1");
    expect(first).toMatchObject({
      modules: [{ id: "module-1", items: [{ id: "lesson-1", type: "lesson", title: { en: "Lesson one" }, required: true }] }],
    });

    expect(manifestWithImportedItem(first, item, "module-1")).toEqual(first);
  });

  it("requires an error-free report and every server checklist field before publishing", () => {
    const complete = {
      outcomesReviewed: true,
      answerKeysVerified: true,
      accessibilityReviewed: true,
      ageAppropriate: true,
      linksValid: true,
      warningsAcknowledged: true,
    } as const;
    expect(isPublishReady(cleanReport, complete)).toBe(true);
    expect(isPublishReady(cleanReport, { ...complete, linksValid: false })).toBe(false);
    expect(isPublishReady({ ...cleanReport, ok: false, errors: [{
      severity: "error",
      code: "E_SCHEMA",
      docId: "manifest",
      path: "/title",
      message: { vi: "Lỗi", en: "Error" },
    }] }, complete)).toBe(false);
  });

  it("routes private asset references through the authenticated media API", () => {
    expect(previewMediaHref({ assetId: "asset/with spaces" })).toBe("/api/v1/media/asset%2Fwith%20spaces");
    expect(previewMediaHref({ url: "https://cdn.example/image.png" })).toBe("https://cdn.example/image.png");
  });
});
