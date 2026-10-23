// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VersionsDrawer } from "@/features/studio/ui/VersionsDrawer";
import messages from "@/messages/en.json";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("VersionsDrawer", () => {
  it("loads a version snapshot locally after the guard and preserves downloads", async () => {
    const user = userEvent.setup();
    const snapshot = { manifest: { id: "ai-foundations" }, items: { intro: { id: "intro" } }, baseVersionId: "version-id" };
    const events: string[] = [];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/versions")) return new Response(JSON.stringify({ data: [{ id: "version-id", version: 3 }] }), { status: 200, headers: { "content-type": "application/json" } });
      events.push("snapshot");
      return new Response(JSON.stringify({ data: snapshot }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const beforeRestore = vi.fn(async () => { events.push("guard"); return true; });
    const onRestored = vi.fn(() => { events.push("apply"); });

    render(<NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId="ai-foundations" refreshKey={0} beforeRestore={beforeRestore} onRestored={onRestored} /></NextIntlClientProvider>);

    await user.click(screen.getByRole("button", { name: messages.workspace.versions.trigger }));
    await screen.findByText("Version 3");
    expect(screen.getByRole("link", { name: messages.workspace.versions.exportBundle })).toHaveAttribute("href", "/api/v1/studio/courses/ai-foundations/export?version=3&format=bundle");
    expect(screen.getByRole("link", { name: messages.workspace.versions.exportSingle })).toHaveAttribute("href", "/api/v1/studio/courses/ai-foundations/export?version=3&format=single");
    await user.click(screen.getByRole("button", { name: messages.workspace.versions.restore }));

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(snapshot));
    expect(events).toEqual(["guard", "snapshot", "apply"]);
  });

  it("does not fetch a snapshot when the replacement guard declines", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetcher = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify({ data: String(input).endsWith("/versions") ? [{ version: 1 }] : {} }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);

    render(<NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId="course-1" refreshKey={0} beforeRestore={async () => false} onRestored={vi.fn()} /></NextIntlClientProvider>);
    await user.click(screen.getByRole("button", { name: messages.workspace.versions.trigger }));
    await screen.findByText("Version 1");
    await user.click(screen.getByRole("button", { name: messages.workspace.versions.restore }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });

  it("keeps downloads available but hides restore controls in read-only mode", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ version: 4 }] }), { status: 200, headers: { "content-type": "application/json" } })));

    render(<NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId="course-1" refreshKey={0} readOnly onRestored={vi.fn()} /></NextIntlClientProvider>);
    await user.click(screen.getByRole("button", { name: messages.workspace.versions.trigger }));
    await screen.findByText("Version 4");

    expect(screen.queryByRole("button", { name: messages.workspace.versions.restore })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: messages.workspace.versions.exportSingle })).toBeInTheDocument();
  });
});
