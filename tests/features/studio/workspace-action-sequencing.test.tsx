// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));

import { FIXTURES } from "@/content-engine/fixtures";
import { inlineWorkspace, parseWorkspace } from "@/content-engine/validate/workspace";
import messages from "@/messages/en.json";
import viMessages from "@/messages/vi.json";
import { ImportDialog } from "@/features/studio/ui/ImportDialog";

const INLINE_MINIMAL = inlineWorkspace(parseWorkspace(FIXTURES.minimal).parsed!);

afterEach(() => {
  cleanup();
  routerPush.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace server action sequencing", () => {
  it("merges a new item locally without invoking the course replacement guard", async () => {
    const beforeReplace = vi.fn(async () => false);
    const fetcher = vi.fn();
    const onApply = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ImportDialog courseId="minimal" manifest={FIXTURES.minimal.manifest} items={FIXTURES.minimal.items} beforeReplace={beforeReplace} onApply={onApply} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("radio", { name: "Single item" }));
    fireEvent.change(screen.getByLabelText("JSON document"), { target: { value: JSON.stringify({ ...(FIXTURES.minimal.items.intro as Record<string, unknown>), id: "imported-intro" }) } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));

    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(beforeReplace).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ items: expect.objectContaining({ "imported-intro": expect.anything() }) }));
  });

  it("creates a different course through the dedicated import endpoint", async () => {
    const imported = { ...INLINE_MINIMAL, id: "new-course" };
    const draft = { courseId: "new-course", manifest: imported, items: FIXTURES.minimal.items, baseVersionId: null };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: { draft } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const onApply = vi.fn();
    const beforeReplace = vi.fn(async () => true);
    vi.stubGlobal("fetch", fetcher);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ImportDialog courseId="" manifest={null} items={{}} canCreate createOnly beforeReplace={beforeReplace} onApply={onApply} />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("JSON document"), { target: { value: JSON.stringify(imported) } });
    fireEvent.click(screen.getByRole("button", { name: "Create and save draft" }));

    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/studio/courses/import");
    expect(beforeReplace).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith("/studio/courses/new-course");
  });

  it("summarizes and locally applies a confirmed replacement of the same course", async () => {
    const onApply = vi.fn();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const replacement = { ...INLINE_MINIMAL, title: "Replacement" };
    render(<NextIntlClientProvider locale="en" messages={messages}><ImportDialog courseId="minimal" manifest={FIXTURES.minimal.manifest} items={FIXTURES.minimal.items} onApply={onApply} /></NextIntlClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.change(screen.getByLabelText("JSON document"), { target: { value: JSON.stringify(replacement) } });
    expect(screen.getByRole("heading", { name: "Change summary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply to draft" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Replace the current course draft with this document" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));

    expect(fetcher).not.toHaveBeenCalled();
    const applied = onApply.mock.calls[0]?.[0];
    expect(applied).toEqual(expect.objectContaining({ manifest: expect.objectContaining({ id: "minimal", title: "Replacement" }) }));
    expect(applied).not.toHaveProperty("baseVersionId");
  });

  it("rejects a stub-only course document before local replacement", async () => {
    const onApply = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={messages}><ImportDialog courseId="minimal" manifest={FIXTURES.minimal.manifest} items={FIXTURES.minimal.items} onApply={onApply} /></NextIntlClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.change(screen.getByLabelText("JSON document"), { target: { value: JSON.stringify(FIXTURES.minimal.manifest) } });

    expect(await screen.findByRole("alert")).toHaveTextContent("include every declared item document inline");
    expect(screen.getByRole("button", { name: "Apply to draft" })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("rejects duplicate ids in a complete inline course", async () => {
    const duplicate = structuredClone(INLINE_MINIMAL);
    const firstItem = duplicate.modules[0]?.items[0];
    if (!firstItem || !duplicate.modules[0]) throw new Error("fixture requires an item");
    duplicate.modules[0].items.push(structuredClone(firstItem));
    const onApply = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={messages}><ImportDialog courseId="minimal" manifest={FIXTURES.minimal.manifest} items={FIXTURES.minimal.items} onApply={onApply} /></NextIntlClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.change(screen.getByLabelText("JSON document"), { target: { value: JSON.stringify(duplicate) } });

    expect(await screen.findByRole("alert")).toHaveTextContent("duplicate ids");
    expect(screen.getByRole("button", { name: "Apply to draft" })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("requires an explicit create choice instead of inferring it from a different id", async () => {
    const imported = { ...INLINE_MINIMAL, id: "new-course" };
    render(<NextIntlClientProvider locale="en" messages={messages}><ImportDialog courseId="minimal" manifest={FIXTURES.minimal.manifest} items={FIXTURES.minimal.items} canCreate onApply={vi.fn()} /></NextIntlClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.change(screen.getByLabelText("JSON document"), { target: { value: JSON.stringify(imported) } });
    expect(screen.getByRole("alert")).toHaveTextContent("imported course id must be minimal");
    expect(screen.getByRole("button", { name: "Apply to draft" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Create new course" }));
    expect(screen.getByRole("button", { name: "Create and save draft" })).not.toBeDisabled();
  });

  it("honors create intent even when the imported id matches the open course", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Course already exists" } }), { status: 409, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const onApply = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={messages}><ImportDialog courseId="minimal" manifest={FIXTURES.minimal.manifest} items={FIXTURES.minimal.items} canCreate onApply={onApply} /></NextIntlClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.change(screen.getByLabelText("JSON document"), { target: { value: JSON.stringify(INLINE_MINIMAL) } });
    fireEvent.click(screen.getByRole("radio", { name: "Create new course" }));
    fireEvent.click(screen.getByRole("button", { name: "Create and save draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP_409");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("rejects oversized JSON files before reading them", async () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><ImportDialog courseId="" manifest={null} items={{}} canCreate createOnly onApply={vi.fn()} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "course.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Choose JSON file"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("2 MB or smaller");
  });

  it("reports file read failures without changing the pasted source", async () => {
    render(<NextIntlClientProvider locale="en" messages={messages}><ImportDialog courseId="" manifest={null} items={{}} canCreate createOnly onApply={vi.fn()} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const file = new File(["{}"], "course.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: vi.fn().mockRejectedValue(new Error("read failed")) });
    fireEvent.change(screen.getByLabelText("Choose JSON file"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be read");
    expect(screen.getByLabelText("JSON document")).toHaveValue("");
  });

  it("stays open while course creation is pending, then navigates after success", async () => {
    let resolveFetch!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    vi.stubGlobal("fetch", vi.fn(() => response));
    const imported = { ...INLINE_MINIMAL, id: "pending-course" };
    render(<NextIntlClientProvider locale="en" messages={messages}><ImportDialog courseId="" manifest={null} items={{}} canCreate createOnly onApply={vi.fn()} /></NextIntlClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.change(screen.getByLabelText("JSON document"), { target: { value: JSON.stringify(imported) } });
    fireEvent.click(screen.getByRole("button", { name: "Create and save draft" }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.getByRole("dialog", { name: "Import course content" })).toBeInTheDocument();
    resolveFetch(new Response(JSON.stringify({ data: { draft: { courseId: "pending-course" } } }), { status: 200, headers: { "content-type": "application/json" } }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/studio/courses/pending-course"));
    expect(screen.queryByRole("dialog", { name: "Import course content" })).not.toBeInTheDocument();
  });

  it("rejects an item id that is already used by another item kind", async () => {
    const onApply = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={messages}><ImportDialog courseId="minimal" manifest={FIXTURES.minimal.manifest} items={{ intro: { kind: "exam" } }} onApply={onApply} /></NextIntlClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("radio", { name: "Single item" }));
    fireEvent.change(screen.getByLabelText("JSON document"), { target: { value: JSON.stringify(FIXTURES.minimal.items.intro) } });

    expect(await screen.findByRole("alert")).toHaveTextContent("already exists as exam");
    expect(screen.getByRole("button", { name: "Apply to draft" })).toBeDisabled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("names conflicting item kinds in Vietnamese for Vietnamese authors", async () => {
    render(<NextIntlClientProvider locale="vi" messages={viMessages}><ImportDialog courseId="minimal" manifest={FIXTURES.minimal.manifest} items={{ intro: { kind: "exam" } }} onApply={vi.fn()} /></NextIntlClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Nhập" }));
    fireEvent.click(screen.getByRole("radio", { name: "Một mục" }));
    fireEvent.change(screen.getByLabelText("Tài liệu JSON"), { target: { value: JSON.stringify(FIXTURES.minimal.items.intro) } });

    expect(await screen.findByRole("alert")).toHaveTextContent("bài kiểm tra");
  });
});
