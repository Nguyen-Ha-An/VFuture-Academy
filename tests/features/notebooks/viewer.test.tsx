// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { NotebookViewer } from "@/features/notebooks/ui/NotebookViewer";

afterEach(cleanup);

const notebook = (cells: unknown[]) => ({
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells,
});

describe("NotebookViewer", () => {
  it("preserves source strings and arrays as read-only React text", () => {
    const source = ["# Hello <script>alert(1)</script>\n", 'print("world")'];
    render(
      <NotebookViewer
        notebook={notebook([
          {
            id: "markdown",
            cell_type: "markdown",
            metadata: {},
            source: source[0],
          },
          { id: "code", cell_type: "code", metadata: {}, source, outputs: [] },
          {
            id: "raw",
            cell_type: "raw",
            metadata: {},
            source: ['<svg onload="alert(1)">raw</svg>'],
          },
        ])}
        locale="en"
      />,
    );

    const codeBlocks = screen.getAllByRole("code");
    expect(codeBlocks[0].textContent).toBe(source[0]);
    expect(codeBlocks[1].textContent).toBe(source.join(""));
    expect(codeBlocks[2].textContent).toBe('<svg onload="alert(1)">raw</svg>');
    expect(document.querySelector("script, svg")).toBeNull();
    expect(
      document.querySelectorAll("input, textarea, button, a"),
    ).toHaveLength(0);
  });

  it("renders text outputs and only bounded local PNG/JPEG data images", () => {
    render(
      <NotebookViewer
        notebook={notebook([
          {
            cell_type: "code",
            metadata: {},
            source: "plot()",
            outputs: [
              { output_type: "stream", text: ["line 1\n", "line 2"] },
              {
                output_type: "display_data",
                data: { "image/png": "iVBORw0KGgo=" },
              },
              {
                output_type: "display_data",
                data: { "image/jpeg": "https://example.test/image.jpg" },
              },
              {
                output_type: "display_data",
                data: { "image/png": "not-base64" },
              },
            ],
          },
        ])}
        locale="en"
      />,
    );

    expect(screen.getAllByRole("code")[0].textContent).toBe("plot()");
    expect(document.body.textContent).toContain("line 1\nline 2");
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute(
      "src",
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(document.querySelector('img[src^="https:"]')).toBeNull();
  });

  it("rejects malformed notebooks with a localized error", () => {
    const { rerender } = render(
      <NotebookViewer notebook={{ nbformat: 3, cells: [] }} locale="vi" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "File notebook không hợp lệ.",
    );
    rerender(
      <NotebookViewer notebook={{ nbformat: 3, cells: [] }} locale="en" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid notebook file.",
    );
  });

  it("keeps long text and images locally bounded with overflow handling", () => {
    const oversized = "A".repeat(2 * 1024 * 1024);
    const { container } = render(
      <NotebookViewer
        notebook={notebook([
          {
            cell_type: "code",
            metadata: {},
            source: oversized,
            outputs: [
              { output_type: "display_data", data: { "image/png": oversized } },
            ],
          },
        ])}
        locale="en"
      />,
    );

    expect(container.querySelector("pre")?.className).toContain(
      "overflow-x-auto",
    );
    expect(container.querySelector("img")).toBeNull();
  });
});
