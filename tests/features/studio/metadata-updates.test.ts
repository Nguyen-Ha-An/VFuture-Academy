import { describe, expect, it } from "vitest";

import {
  addLearningOutcome,
  removeLearningOutcome,
  setLearningOutcomeText,
  setLocalizedMetadata,
  setMetadata,
} from "@/features/studio/metadata-updates";

const course = {
  $schema: "https://example.test/course.schema.json",
  schemaVersion: 1,
  kind: "course",
  id: "future-course",
  title: "Khóa học tương lai",
  summary: { vi: "Tóm tắt", en: "Summary" },
  description: [{ type: "paragraph", content: [{ type: "text", text: "Keep rich content" }] }],
  cover: { url: "https://example.test/cover.jpg" },
  languages: ["vi", "en"],
  defaultLanguage: "vi",
  level: "foundation",
  difficulty: "beginner",
  pathway: "core-future-skills",
  tags: ["future", "ai"],
  estimatedMinutes: 45,
  learningOutcomes: [
    { vi: "Hiểu tương lai", en: "Understand the future" },
    "Xây dựng dự án",
  ],
  access: { scope: "global" },
  completion: { rules: [{ type: "all_items" }], certificate: true },
  modules: [{
    id: "module-1",
    title: "Module 1",
    summary: "Keep module summary",
    items: [{
      id: "lesson-1",
      type: "lesson",
      title: "Lesson",
      required: false,
      estimatedMinutes: 12,
      blocks: [{ type: "paragraph", content: [{ type: "text", text: "Keep inline body" }] }],
      customInlineField: { keep: true },
    }],
  }],
  customRootField: { nested: [1, 2, 3] },
};

describe("metadata update helpers", () => {
  it("adds a secondary translation without losing the scalar default-language title or any unexposed course data", () => {
    const updated = setLocalizedMetadata(course, "title", "en", "Future course", "vi");

    expect(updated).toEqual({
      ...course,
      title: { vi: "Khóa học tương lai", en: "Future course" },
    });
    expect(updated).not.toBe(course);
    expect(course.title).toBe("Khóa học tương lai");
  });

  it("keeps scalar semantics when the default-language scalar is edited", () => {
    expect(setLocalizedMetadata(course, "title", "vi", "Tương lai số", "vi")).toEqual({
      ...course,
      title: "Tương lai số",
    });
  });

  it("patches only selected item metadata and retains identity, kind, body, settings, rules and references", () => {
    const item = {
      schemaVersion: 1,
      kind: "exam",
      id: "exam-1",
      title: { vi: "Bài thi", en: "Exam" },
      summary: "Summary",
      estimatedMinutes: 30,
      sections: [{ id: "section-1", title: "Section", questions: [{ ref: "question-1" }] }],
      settings: { attempts: 2, shuffle: true },
      grading: { passingPercent: 75 },
      references: [{ id: "resource-1" }],
      unknownFutureField: { preserved: true },
    };

    const updated = setMetadata(
      setLocalizedMetadata(item, "summary", "en", "Updated summary", "vi"),
      "estimatedMinutes",
      50,
    );

    expect(updated).toEqual({
      ...item,
      summary: { vi: "Summary", en: "Updated summary" },
      estimatedMinutes: 50,
    });
    expect(item.sections[0]?.questions[0]?.ref).toBe("question-1");
  });

  it("edits one outcome locale while preserving its paired translation and every other outcome", () => {
    const updated = setLearningOutcomeText(course, 0, "en", "Plan for the future", "vi") as typeof course;

    expect(updated.learningOutcomes).toEqual([
      { vi: "Hiểu tương lai", en: "Plan for the future" },
      "Xây dựng dự án",
    ]);
    expect(updated.modules).toEqual(course.modules);
  });

  it("adds and removes only the selected outcome while retaining schema version one", () => {
    const withOutcome = addLearningOutcome(course, "en") as typeof course;
    expect(withOutcome.learningOutcomes).toEqual([
      ...course.learningOutcomes,
      { en: "" },
    ]);

    const withoutFirst = removeLearningOutcome(withOutcome, 0) as typeof course;
    expect(withoutFirst.learningOutcomes).toEqual([
      "Xây dựng dự án",
      { en: "" },
    ]);
    expect(withoutFirst.schemaVersion).toBe(1);
    expect(withoutFirst.customRootField).toEqual({ nested: [1, 2, 3] });
  });

  it("returns malformed input untouched instead of reconstructing it", () => {
    const malformed = ["unexpected", { retained: true }];
    expect(setMetadata(malformed, "estimatedMinutes", 20)).toBe(malformed);
    expect(setLocalizedMetadata(malformed, "title", "en", "Title", "vi")).toBe(malformed);
  });

  it("retains an invalid unedited field byte-for-value while another metadata field is corrected", () => {
    const invalidTitle = { vi: "Tiêu đề", futureLocale: { keep: true } };
    const invalidDocument = { ...course, title: invalidTitle, estimatedMinutes: 0 };

    const updated = setMetadata(invalidDocument, "estimatedMinutes", 20) as typeof invalidDocument;

    expect(updated.title).toEqual(invalidTitle);
    expect(updated.estimatedMinutes).toBe(20);
    expect(updated.modules).toEqual(course.modules);
  });
});
