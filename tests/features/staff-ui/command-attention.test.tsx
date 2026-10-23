// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionPopover } from "@/features/staff-ui/ui/AttentionPopover";
import type { AdminScope } from "@/lib/admin-scope";
import type { Permission } from "@/lib/permissions";
import type { StaffWorkspace } from "@/lib/workspaces";
import en from "@/messages/en.json";
import viMessages from "@/messages/vi.json";
import { staffUiTestMessages } from "@/messages/staff-ui";

vi.mock("next/navigation", () => ({
  usePathname: () => "/studio",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}));

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HANOI: AdminScope = { kind: "branch", branchId: "hanoi" };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { data } : { error: { message: "nope", code: "FORBIDDEN" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function respond(routes: { reviews?: () => Response | Promise<Response>; submissions?: () => Response | Promise<Response> }) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("/api/v1/studio/reviews") && routes.reviews) return routes.reviews();
    if (url.startsWith("/api/v1/studio/submissions") && routes.submissions) return routes.submissions();
    throw new Error(`unexpected fetch ${url}`);
  });
}

function renderBell({
  workspace = "studio",
  permissions = ["content.review", "submission.grade"],
  activeScope = HANOI,
  locale = "en",
}: { workspace?: StaffWorkspace; permissions?: Permission[]; activeScope?: AdminScope; locale?: "en" | "vi" } = {}) {
  return render(
    <NextIntlClientProvider locale={locale} messages={staffUiTestMessages(locale === "en" ? en : viMessages, locale)}>
      <AttentionPopover workspace={workspace} permissions={permissions} activeScope={activeScope} />
    </NextIntlClientProvider>,
  );
}

function openBell(name: string | RegExp = /^Needs attention/) {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

const reviews = [{ id: "r1", status: "pending" }, { id: "r2", status: "approved" }, { id: "r3", status: "pending" }];
const fullPage = { items: Array.from({ length: 50 }, (_, index) => ({ id: `s${index}` })), nextCursor: "cursor-2" };

describe("AttentionPopover", () => {
  it("renders nothing without review or grading permission", () => {
    const { container } = renderBell({ permissions: ["course.read", "content.read", "content.review.request"] });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not fetch on mount and shows no badge until counts are known", () => {
    respond({ reviews: () => json(reviews), submissions: () => json(fullPage) });
    renderBell();
    const bell = screen.getByRole("button", { name: "Needs attention" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(bell.querySelector('[data-slot="attention-badge"]')).toBeNull();
  });

  it("fetches on open with the active scope and shows pending reviews and N+ submissions", async () => {
    respond({ reviews: () => json(reviews), submissions: () => json(fullPage) });
    renderBell();
    const popover = await openBell();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toContain("/api/v1/studio/reviews?scope=branch%3Ahanoi");
    expect(urls).toContain("/api/v1/studio/submissions?scope=branch%3Ahanoi&status=submitted&branchId=hanoi");

    const reviewRow = await within(popover).findByRole("link", { name: /Reviews waiting/ });
    await waitFor(() => expect(reviewRow).toHaveTextContent("Reviews waiting2"));
    expect(reviewRow).toHaveAttribute("href", "/studio/reviews");
    const queueRow = within(popover).getByRole("link", { name: /Submissions to grade/ });
    await waitFor(() => expect(queueRow).toHaveTextContent("Submissions to grade50+"));
    expect(queueRow).toHaveAttribute("href", "/grading/queue");

    const bell = screen.getByRole("button", { name: "Needs attention: 52+", hidden: true });
    expect(bell.querySelector('[data-slot="attention-badge"]')).toHaveTextContent("52+");
  });

  it("shows a plain count when the queue fits on one page", async () => {
    respond({ submissions: () => json({ items: [{ id: "a" }, { id: "b" }, { id: "c" }], nextCursor: null }) });
    renderBell({ workspace: "grading", permissions: ["submission.grade"], activeScope: { kind: "central" } });
    const popover = await openBell();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/studio/submissions?scope=central&status=submitted");
    const row = within(popover).getByRole("link", { name: /Submissions to grade/ });
    await waitFor(() => expect(row).toHaveTextContent("Submissions to grade3"));
    expect(within(popover).queryByText("Reviews waiting")).not.toBeInTheDocument();
  });

  it("shows a loading state, then Unavailable for a failed source while the other still loads", async () => {
    let releaseQueue: (response: Response) => void = () => {};
    respond({
      reviews: () => json(null, 403),
      submissions: () => new Promise<Response>((resolve) => { releaseQueue = resolve; }),
    });
    renderBell({ permissions: ["content.publish", "submission.grade"] });
    const popover = await openBell();
    const reviewRow = within(popover).getByRole("link", { name: /Reviews waiting/ });
    const queueRow = within(popover).getByRole("link", { name: /Submissions to grade/ });
    await waitFor(() => expect(reviewRow).toHaveTextContent("Unavailable"));
    expect(queueRow).toHaveTextContent("Loading…");
    await act(async () => { releaseQueue(json({ items: [{ id: "a" }], nextCursor: null })); });
    await waitFor(() => expect(queueRow).toHaveTextContent("Submissions to grade1"));
    expect(reviewRow).toHaveTextContent("Unavailable");
  });

  it("treats a malformed response as unavailable", async () => {
    respond({ reviews: () => json({ not: "a list" }) });
    renderBell({ permissions: ["content.review"] });
    const popover = await openBell();
    await waitFor(() => expect(within(popover).getByRole("link", { name: /Reviews waiting/ })).toHaveTextContent("Unavailable"));
  });

  it("shows the empty state when nothing is waiting", async () => {
    respond({ reviews: () => json([{ id: "r2", status: "approved" }]), submissions: () => json({ items: [], nextCursor: null }) });
    renderBell({ locale: "vi" });
    const popover = await openBell(/^Cần xử lý/);
    expect(await within(popover).findByText("Hiện không có việc cần xử lý.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cần xử lý", hidden: true }).querySelector('[data-slot="attention-badge"]')).toBeNull();
  });

  it("refetches on every open", async () => {
    respond({ reviews: () => json(reviews) });
    renderBell({ permissions: ["content.review"] });
    await openBell();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Needs attention/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
