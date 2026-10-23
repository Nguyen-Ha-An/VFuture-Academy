// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Range, ValidationReport } from "@/content-engine/diagnostics";
import { DiagnosticsPanel } from "@/features/studio/ui/DiagnosticsPanel";

const messages = {
  workspace: {
    diagnostics: {
      label: "Diagnostics",
      title: "Diagnostics",
      copy: "Copy report",
      copied: "Report copied",
      copyError: "The report could not be copied.",
      empty: "No diagnostics",
      severity: "Severity",
      document: "Document",
      location: "Location",
      message: "Message",
      error: "Error",
      warning: "Warning",
      line: "Line {line}, column {col}",
      pathOnly: "Path {path}",
      select: "Open {code} in {docId}",
    },
  },
};

describe("workspace diagnostics", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("selects the diagnostic document and exact source range", () => {
    const range: Range = { start: { line: 7, col: 5 }, end: { line: 7, col: 12 } };
    const report: ValidationReport = {
      ok: false,
      errors: [{
        severity: "error",
        code: "E_SCHEMA",
        docId: "lesson-1",
        path: "/blocks/2/type",
        range,
        message: { vi: "Sai cấu trúc", en: "Schema violation" },
      }],
      warnings: [],
      summary: {
        modules: 1,
        items: { lesson: 1, exam: 0, assignment: 0 },
        blocks: 3,
        questions: {},
        totalPoints: 0,
        languages: ["vi", "en"],
      },
    };
    const onSelect = vi.fn();

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DiagnosticsPanel report={report} locale="en" onSelect={onSelect} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open E_SCHEMA in lesson-1" }));
    expect(onSelect).toHaveBeenCalledWith("lesson-1", range, expect.objectContaining({ code: "E_SCHEMA", docId: "lesson-1" }));
  });

  it("shows clipboard failures instead of leaving an unhandled rejection", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const report: ValidationReport = {
      errors: [{
        severity: "error",
        code: "E_SCHEMA",
        docId: "manifest",
        path: "/title",
        message: { vi: "Lá»—i", en: "Error" },
      }],
      warnings: [],
      ok: false,
      summary: { modules: 0, items: { lesson: 0, exam: 0, assignment: 0 }, blocks: 0, questions: {}, totalPoints: 0, languages: [] },
    };
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DiagnosticsPanel report={report} locale="en" onSelect={vi.fn()} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByRole("alert").textContent).toBe("The report could not be copied.");
  });

  it("resets copied feedback after two seconds", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const report: ValidationReport = {
      errors: [{
        severity: "error",
        code: "E_SCHEMA",
        docId: "manifest",
        path: "/title",
        message: { vi: "Lá»—i", en: "Error" },
      }],
      warnings: [],
      ok: false,
      summary: { modules: 0, items: { lesson: 0, exam: 0, assignment: 0 }, blocks: 0, questions: {}, totalPoints: 0, languages: [] },
    };
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DiagnosticsPanel report={report} locale="en" onSelect={vi.fn()} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("button", { name: "Report copied" })).toBeDefined();

    act(() => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByRole("button", { name: "Copy report" })).toBeDefined();
  });
});
