// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
    const onRestored = vi.fn(() => { events.push("apply"); return true; });

    render(<NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId="ai-foundations" refreshKey={0} beforeRestore={beforeRestore} onRestored={onRestored} /></NextIntlClientProvider>);

    await user.click(screen.getByRole("button", { name: messages.workspace.versions.trigger }));
    await screen.findByText("Version 3");
    expect(screen.getByRole("link", { name: messages.workspace.versions.exportBundle })).toHaveAttribute("href", "/api/v1/studio/courses/ai-foundations/export?version=3&format=bundle");
    expect(screen.getByRole("link", { name: messages.workspace.versions.exportSingle })).toHaveAttribute("href", "/api/v1/studio/courses/ai-foundations/export?version=3&format=single");
    await user.click(screen.getByRole("button", { name: messages.workspace.versions.restore }));

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(snapshot));
    expect(events).toEqual(["guard", "snapshot", "apply"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(messages.workspace.versions.restoreCancelled);
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

  it("keeps history and downloads open when canonical apply refuses the snapshot", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const snapshot = { manifest: { id: "course-1" }, items: {}, baseVersionId: "version-1" };
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify({ data: String(input).endsWith("/versions") ? [{ version: 1 }] : snapshot }), { headers: { "content-type": "application/json" } })));
    const apply = vi.fn(async () => false);
    render(<NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId="course-1" refreshKey={0} onRestored={apply} /></NextIntlClientProvider>);
    await user.click(screen.getByRole("button", { name: messages.workspace.versions.trigger }));
    await screen.findByText("Version 1");
    await user.click(screen.getByRole("button", { name: messages.workspace.versions.restore }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(snapshot));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(messages.workspace.versions.restoreNotApplied);
    expect(screen.getByRole("link", { name: messages.workspace.versions.exportBundle })).toBeInTheDocument();
  });

  it("cancels confirmation without requesting a snapshot or applying it", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ version: 1 }] }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const apply = vi.fn(() => true);
    render(<NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId="course-1" refreshKey={0} onRestored={apply} /></NextIntlClientProvider>);
    await user.click(screen.getByRole("button", { name: messages.workspace.versions.trigger }));
    await screen.findByText("Version 1");
    await user.click(screen.getByRole("button", { name: messages.workspace.versions.restore }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(messages.workspace.versions.restoreCancelled);
  });

  it.each(['guard', 'snapshot'] as const)("does not apply when workflow locks during the %s wait", async (phase) => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let releaseGuard!: (allowed: boolean) => void;
    let releaseSnapshot!: (response: Response) => void;
    const guardPromise = new Promise<boolean>(resolve => { releaseGuard = resolve; });
    const snapshotPromise = new Promise<Response>(resolve => { releaseSnapshot = resolve; });
    const snapshot = { manifest: { id: "course-1" }, items: {}, baseVersionId: "version-1" };
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/versions')
      ? new Response(JSON.stringify({ data: [{ version: 1 }] }), { headers: { 'content-type': 'application/json' } })
      : snapshotPromise);
    vi.stubGlobal('fetch', fetcher);
    const apply = vi.fn(() => true);
    const guard = () => phase === 'guard' ? guardPromise : Promise.resolve(true);
    const element = (locked: boolean) => <NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId="course-1" refreshKey={0} restoreDisabled={locked} beforeRestore={guard} onRestored={apply} /></NextIntlClientProvider>;
    const view = render(element(false));
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.trigger }));
    await screen.findByText('Version 1');
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.restore }));
    if (phase === 'snapshot') await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    view.rerender(element(true));
    await act(async () => {
      if (phase === 'guard') releaseGuard(true);
      else releaseSnapshot(new Response(JSON.stringify({ data: snapshot }), { headers: { 'content-type': 'application/json' } }));
    });
    expect(apply).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(phase === 'guard' ? 1 : 2);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.workspace.versions.restore })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(messages.workspace.versions.restoreBlocked);
    expect(screen.getByRole('link', { name: messages.workspace.versions.exportSingle })).toBeInTheDocument();
  });

  it("keeps locked-author history browsable without enabling restoration", async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ version: 1 }] }), { headers: { 'content-type': 'application/json' } })));
    const apply = vi.fn(() => true);
    render(<NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId="course-1" refreshKey={0} restoreDisabled onRestored={apply} /></NextIntlClientProvider>);
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.trigger }));
    await screen.findByText('Version 1');
    expect(screen.getByRole('button', { name: messages.workspace.versions.restore })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(messages.workspace.versions.restoreBlocked);
    expect(screen.getByRole('link', { name: messages.workspace.versions.exportSingle })).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });

  it("keeps the drawer open on a failed snapshot request and never calls apply", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(String(input).endsWith('/versions') ? { data: [{ version: 1 }] } : { error: { message: 'Snapshot unavailable' } }), { status: String(input).endsWith('/versions') ? 200 : 503, headers: { 'content-type': 'application/json' } })));
    const apply = vi.fn(() => true);
    render(<NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId="course-1" refreshKey={0} onRestored={apply} /></NextIntlClientProvider>);
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.trigger }));
    await screen.findByText('Version 1');
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.restore }));
    await screen.findByRole('alert');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });


  it.each(['guard', 'snapshot'] as const)("ignores the old %s operation after close and reopen", async (phase) => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let releaseGuard!: (allowed: boolean) => void;
    let releaseSnapshot!: (response: Response) => void;
    const guardPromise = new Promise<boolean>(resolve => { releaseGuard = resolve; });
    const snapshotPromise = new Promise<Response>(resolve => { releaseSnapshot = resolve; });
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/versions')
      ? new Response(JSON.stringify({ data: [{ version: 1 }] }), { headers: { 'content-type': 'application/json' } })
      : snapshotPromise);
    vi.stubGlobal('fetch', fetcher);
    let draftTitle = 'Initial draft';
    const apply = vi.fn(() => { draftTitle = 'Old published title'; return true; });
    const guard = () => phase === 'guard' ? guardPromise : Promise.resolve(true);
    render(<NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId="course-1" refreshKey={0} beforeRestore={guard} onRestored={apply} /></NextIntlClientProvider>);
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.trigger }));
    await screen.findByText('Version 1');
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.restore }));
    if (phase === 'snapshot') await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    draftTitle = 'New unsaved edits after closing';
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.trigger }));
    await screen.findByText('Version 1');
    await act(async () => {
      if (phase === 'guard') releaseGuard(true);
      else releaseSnapshot(new Response(JSON.stringify({ data: { manifest: { id: 'course-1' }, items: {}, baseVersionId: 'version-1' } }), { headers: { 'content-type': 'application/json' } }));
    });
    expect(apply).not.toHaveBeenCalled();
    expect(draftTitle).toBe('New unsaved edits after closing');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.workspace.versions.restore })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(phase === 'guard' ? 2 : 3);
  });

  it("ignores a pending restore after course identity changes and returns", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let releaseSnapshot!: (response: Response) => void;
    const snapshotPromise = new Promise<Response>(resolve => { releaseSnapshot = resolve; });
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/versions')
      ? new Response(JSON.stringify({ data: [{ version: 1 }] }), { headers: { 'content-type': 'application/json' } })
      : snapshotPromise);
    vi.stubGlobal('fetch', fetcher);
    const apply = vi.fn(() => true);
    const element = (id: string) => <NextIntlClientProvider locale="en" messages={messages}><VersionsDrawer courseId={id} refreshKey={0} onRestored={apply} /></NextIntlClientProvider>;
    const view = render(element('course-1'));
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.trigger }));
    await screen.findByText('Version 1');
    await user.click(screen.getByRole('button', { name: messages.workspace.versions.restore }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    view.rerender(element('course-2'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    view.rerender(element('course-1'));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    await act(async () => { releaseSnapshot(new Response(JSON.stringify({ data: { manifest: { id: 'course-1' }, items: {}, baseVersionId: 'version-1' } }), { headers: { 'content-type': 'application/json' } })); });
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.workspace.versions.restore })).toBeEnabled();
  });

});
