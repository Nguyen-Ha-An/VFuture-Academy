// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COURSE_REF } from '@/content-engine/diagnostics';

import type { ValidationReport } from "@/content-engine/diagnostics";
import { Outline, outlineStatus } from "@/features/studio/ui/Outline";

const messages = {
  workspace: {
    outline: {
      label: "Course outline",
      manifest: "Course manifest",
      empty: "No modules yet",
      moduleUntitled: "Untitled module",
      itemUntitled: "Untitled item",
      addModule: "Add module",
      addItem: "Add item",
      itemKind: "Item kind",
      moduleTitle: "Title for {id}",
      itemTitle: "Title for {id}",
      deleteModule: "Remove module {title}",
      deleteItem: "Remove {title}",
      confirmDeleteModule: "Remove module {title} from the outline?",
      confirmDelete: "Remove {title} from the outline?",
      moveUp: "Move {title} up",
      moveDown: "Move {title} down",
      itemKinds: { lesson: "Lesson", exam: "Exam", assignment: "Assignment" },
    },
    badges: {
      valid: "Valid",
      warnings: "{count} warnings",
      errors: "{count} errors",
      stub: "Stub without document",
    },
  },
};

const manifest = {
  schemaVersion: 1,
  kind: "course",
  id: "course-1",
  modules: [{
    id: "module-1",
    title: "Foundations",
    items: [
      { id: "valid-item", type: "lesson", title: "Valid item" },
      { id: "warning-item", type: "lesson", title: "Warning item" },
      { id: "error-item", type: "exam", title: "Error item" },
      { id: "missing-item", type: "assignment", title: "Missing item" },
    ],
  }],
};

const report: ValidationReport = {
  ok: false,
  errors: [
    {
      severity: "error",
      code: "E_SCHEMA",
      docId: "error-item",
      path: "/sections",
      message: { vi: "Lỗi", en: "Error" },
    },
    {
      severity: "error",
      code: "E_MISSING_ITEM_DOCUMENT",
      docId: "missing-item",
      path: "/modules/0/items/3",
      message: { vi: "Thiếu", en: "Missing" },
    },
  ],
  warnings: [
    {
      severity: "warning",
      code: "W_NO_OBJECTIVES",
      docId: "warning-item",
      path: "/objectives",
      message: { vi: "Cảnh báo", en: "Warning" },
    },
    {
      severity: "warning",
      code: "W_LESSON_NO_ACTIVITY",
      docId: "warning-item",
      path: "/blocks",
      message: { vi: "Cảnh báo", en: "Warning" },
    },
  ],
  summary: {
    modules: 1,
    items: { lesson: 2, exam: 1, assignment: 1 },
    blocks: 0,
    questions: {},
    totalPoints: 0,
    languages: ["vi", "en"],
  },
};

describe("course workspace outline", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("computes valid, warning, error, and missing-document badges from the last report", () => {
    expect(outlineStatus("valid-item", true, report)).toEqual({ kind: "valid", count: 0 });
    expect(outlineStatus("warning-item", true, report)).toEqual({ kind: "warning", count: 2 });
    expect(outlineStatus("error-item", true, report)).toEqual({ kind: "error", count: 1 });
    expect(outlineStatus("missing-item", false, report)).toEqual({ kind: "stub", count: 0 });

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Outline
          manifest={manifest}
          items={{ "valid-item": {}, "warning-item": {}, "error-item": {} }}
          report={report}
          selectedRef={COURSE_REF}
          onSelect={vi.fn()}
          onManifestChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("button", { name: /Valid item.*Valid/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Warning item.*2 warnings/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Error item.*1 errors/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Missing item.*Stub without document/i })).toBeDefined();
  });

  it("preserves module and item metadata when reordering the outline", () => {
    const onManifestChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Outline
          manifest={{
            id: "course-1",
            modules: [{
              id: "module-1",
              title: "Module one",
              summary: "Keep module summary",
              items: [
                { id: "one", type: "lesson", title: "Item one", required: false, estimatedMinutes: 12 },
                { id: "two", type: "lesson", title: "Item two", required: true },
              ],
            }],
          }}
          items={{ one: {}, two: {} }}
          report={{ ...report, errors: [], warnings: [] }}
          selectedRef={COURSE_REF}
          onSelect={vi.fn()}
          onManifestChange={onManifestChange}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move Item one down" }));
    expect(onManifestChange).toHaveBeenCalledWith(expect.objectContaining({
      modules: [expect.objectContaining({
        summary: "Keep module summary",
        items: [
          expect.objectContaining({ id: "two", required: true }),
          expect.objectContaining({ id: "one", required: false, estimatedMinutes: 12 }),
        ],
      })],
    }));
  });

  it("indexes diagnostic counts once instead of filtering the report for every item", () => {
    const errorsFilter = vi.spyOn(report.errors, "filter");
    const warningsFilter = vi.spyOn(report.warnings, "filter");

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Outline
          manifest={manifest}
          items={{ "valid-item": {}, "warning-item": {}, "error-item": {} }}
          report={report}
          selectedRef={COURSE_REF}
          onSelect={vi.fn()}
          onManifestChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(errorsFilter).not.toHaveBeenCalled();
    expect(warningsFilter).not.toHaveBeenCalled();
  });

  it("removes only the selected item reference through the manifest change path", () => {
    const onManifestChange = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Outline
          manifest={manifest}
          items={{ "valid-item": {}, "warning-item": {}, "error-item": {} }}
          report={report}
          selectedRef={COURSE_REF}
          onSelect={vi.fn()}
          onManifestChange={onManifestChange}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Valid item" }));
    expect(confirm).toHaveBeenCalledWith("Remove Valid item from the outline?");
    expect(onManifestChange).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove Valid item" }));
    expect(onManifestChange).toHaveBeenCalledWith(expect.objectContaining({
      modules: [expect.objectContaining({
        items: [
          expect.objectContaining({ id: "warning-item" }),
          expect.objectContaining({ id: "error-item" }),
          expect.objectContaining({ id: "missing-item" }),
        ],
      })],
    }));
  });

  it("renames localized module and item titles without replacing their metadata", () => {
    const onManifestChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Outline
          manifest={{
            id: "course-1",
            modules: [{
              id: "module-1",
              title: { vi: "Mô-đun", en: "Module" },
              summary: "Keep summary",
              items: [
                { id: "one", type: "lesson", title: { vi: "Bài", en: "Item" }, required: true },
                { id: "two", type: "lesson", title: "Second" },
              ],
            }],
          }}
          items={{ one: {}, two: {} }}
          report={{ ...report, errors: [], warnings: [] }}
          selectedRef={COURSE_REF}
          onSelect={vi.fn()}
          onManifestChange={onManifestChange}
        />
      </NextIntlClientProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Title for module-1" }), { target: { value: "Renamed module" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "Title for module-1" }));
    expect(onManifestChange).toHaveBeenLastCalledWith(expect.objectContaining({
      modules: [expect.objectContaining({ title: { vi: "Mô-đun", en: "Renamed module" }, summary: "Keep summary" })],
    }));

    fireEvent.change(screen.getByRole("textbox", { name: "Title for one" }), { target: { value: "Renamed item" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "Title for one" }));
    expect(onManifestChange).toHaveBeenLastCalledWith(expect.objectContaining({
      modules: [expect.objectContaining({
        items: [expect.objectContaining({ title: { vi: "Bài", en: "Renamed item" }, required: true }), expect.anything()],
      })],
    }));
  });

  it("blocks removing the last item or last module instead of inventing replacements", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Outline
          manifest={{ id: "course-1", modules: [{ id: "only-module", title: "Only module", items: [{ id: "only-item", type: "lesson", title: "Only item" }] }] }}
          items={{ "only-item": {} }}
          report={{ ...report, errors: [], warnings: [] }}
          selectedRef={COURSE_REF}
          onSelect={vi.fn()}
          onManifestChange={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Remove Only item" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Remove module Only module" }).hasAttribute("disabled")).toBe(true);
  });
});
