// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { itemRef } from '@/content-engine/diagnostics';

import type { Diagnostic } from "@/content-engine/diagnostics";
import { JsonEditor, mapDiagnosticsToCodeMirror, structuralDiagnosticsForSource } from "@/features/studio/ui/JsonEditor";

afterEach(() => cleanup());

const messages = {
  workspace: {
    editor: {
      accessibleName: "JSON editor for {docId}",
      format: "Format",
      formatError: "Fix JSON first",
      pasteReplace: "Paste and replace",
      pasteError: "Clipboard unavailable",
      saveStates: {
        idle: "Saved",
        waiting: "Unsaved changes",
        saving: "Saving",
        saved: "Saved",
        conflict: "Save conflict",
        error: "Not saved",
      },
    },
  },
};

beforeAll(() => {
  Range.prototype.getClientRects = () => ({
    item: () => null,
    length: 0,
    [Symbol.iterator]: function* iterator() {},
  }) as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

describe("workspace JSON editor diagnostic mapping", () => {
  it("maps one-based line and column ranges to CodeMirror offsets for the open document", () => {
    const source = "{\n  \"kind\": \"lesson\"\n}\n";
    const diagnostics: Diagnostic[] = [
      {
        severity: "error",
        code: "E_SCHEMA",
        docId: "lesson-1",
        path: "/kind",
        range: { start: { line: 2, col: 3 }, end: { line: 2, col: 9 } },
        message: { vi: "Sai cấu trúc", en: "Schema violation" },
      },
      {
        severity: "warning",
        code: "W_NO_OBJECTIVES",
        docId: "lesson-2",
        path: "/objectives",
        range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
        message: { vi: "Thiếu mục tiêu", en: "Missing objectives" },
      },
    ];

    expect(mapDiagnosticsToCodeMirror(EditorState.create({ doc: source }).doc, diagnostics, "lesson-1", "en")).toEqual([{
      from: 4,
      to: 10,
      severity: "error",
      source: "E_SCHEMA",
      message: "Schema violation",
    }]);
  });

  it("maps CRLF ranges against CodeMirror's normalized document", () => {
    const doc = EditorState.create({ doc: "ab\r\ncd" }).doc;
    const diagnostic: Diagnostic = {
      severity: "error",
      code: "E_SCHEMA",
      docId: "lesson-1",
      path: "",
      range: { start: { line: 2, col: 1 }, end: { line: 2, col: 3 } },
      message: { vi: "Lá»—i", en: "Error" },
    };

    expect(mapDiagnosticsToCodeMirror(doc, [diagnostic], "lesson-1", "en")[0]).toMatchObject({
      from: 3,
      to: 5,
    });
  });

  it("uses UTF-16 columns for astral characters and clamps ranges to the editor line", () => {
    const doc = EditorState.create({ doc: "\u{1f600}x\nz" }).doc;
    const diagnostic: Diagnostic = {
      severity: "warning",
      code: "W_NO_OBJECTIVES",
      docId: "lesson-1",
      path: "",
      range: { start: { line: 1, col: 3 }, end: { line: 1, col: 99 } },
      message: { vi: "Cáº£nh bÃ¡o", en: "Warning" },
    };

    expect(mapDiagnosticsToCodeMirror(doc, [diagnostic], "lesson-1", "en")[0]).toMatchObject({
      from: 2,
      to: 3,
    });
  });

  it("does not reselect a focused diagnostic after the first typed character", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [source, setSource] = useState("abcd");
      const [focusRange] = useState({ start: { line: 1, col: 2 }, end: { line: 1, col: 4 } });
      return (
        <JsonEditor
          source={source}
          docRef={itemRef('lesson-1')}
          diagnostics={[]}
          locale="en"
          saveState="idle"
          focusRange={focusRange}
          onChange={setSource}
        />
      );
    }

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Harness />
      </NextIntlClientProvider>,
    );

    const editor = screen.getByRole("textbox", { name: "JSON editor for lesson-1" });
    await user.keyboard("XY");

    await waitFor(() => {
      const view = EditorView.findFromDOM(editor);
      expect(view).not.toBeNull();
      expect(view!.state.doc.toString()).toBe("aXYd");
      expect(view!.state.selection.main.empty).toBe(true);
    });
  });

  it("adds a source range to structural errors in valid JSON before persistence", () => {
    const diagnostics = structuralDiagnosticsForSource('{\n  "schemaVersion": 1,\n  "kind": "leson",\n  "id": "lesson-1"\n}', "lesson-1");

    expect(diagnostics).toEqual([expect.objectContaining({
      code: "E_UNKNOWN_KIND",
      docId: "lesson-1",
      path: "/kind",
      range: { start: { line: 3, col: 11 }, end: { line: 3, col: 18 } },
    })]);
  });
});

describe('Format never reinterprets the author text', () => {
  const formatted = (source: string) => {
    const onChange = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={messages}>
      <JsonEditor source={source} docRef={itemRef('intro')} diagnostics={[]} locale="en" saveState="idle" onChange={onChange} />
    </NextIntlClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: /format/i }));
    return onChange;
  };

  it('refuses to format a duplicate key and leaves the exact source alone', () => {
    // JSON.parse would keep only the last `title`, so formatting would silently
    // delete the author's first value and then look correct.
    const onChange = formatted('{"kind":"lesson","title":"first","title":"second"}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/"title" is declared/i);
  });

  it('refuses to format an overflowing number', () => {
    const onChange = formatted('{"kind":"lesson","points":1e999}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('refuses to format a non-object root', () => {
    const onChange = formatted('[1,2,3]');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses to format unparseable text', () => {
    const onChange = formatted('{"kind":');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('formats schema-invalid but syntactically sound text, keeping every field', () => {
    const onChange = formatted('{"kind":"lesson","unknownField":1,"blocks":[]}');
    expect(onChange).toHaveBeenCalledOnce();
    const result = JSON.parse(String(onChange.mock.calls[0]?.[0]));
    expect(result).toEqual({ kind: 'lesson', unknownField: 1, blocks: [] });
    expect(String(onChange.mock.calls[0]?.[0])).toContain('\n  ');
  });
});
