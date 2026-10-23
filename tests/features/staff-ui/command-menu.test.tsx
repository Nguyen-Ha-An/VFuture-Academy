// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StaffCommandMenu } from "@/features/staff-ui/ui/StaffCommandMenu";
import type { Permission } from "@/lib/permissions";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import type { StaffWorkspace } from "@/lib/workspaces";
import en from "@/messages/en.json";
import viMessages from "@/messages/vi.json";
import { staffUiTestMessages } from "@/messages/staff-ui";

const mocks = vi.hoisted(() => ({
  pathname: "/studio",
  push: vi.fn(),
  requestNavigation: vi.fn<() => Promise<boolean>>(),
  applyStaffTheme: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/navigation-guard", () => ({
  requestNavigation: mocks.requestNavigation,
  registerNavigationGuard: () => () => {},
}));

vi.mock("@/features/staff-ui/theme-client", () => ({
  applyStaffTheme: mocks.applyStaffTheme,
  // The real hook's setter is applyStaffTheme plus local state.
  useStaffTheme: (initial: string) => [initial, (next: string) => mocks.applyStaffTheme(next)],
}));

beforeAll(() => {
  // cmdk measures its list and scrolls the active item into view.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  mocks.pathname = "/studio";
  mocks.push.mockReset();
  mocks.requestNavigation.mockReset().mockResolvedValue(true);
  mocks.applyStaffTheme.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ALL_ENTRIES: WorkspaceEntries = { studio: "/studio", grading: "/grading", admin: "/admin" };

function renderMenu({
  workspace = "studio",
  permissions = ["course.read", "content.read", "content.review"],
  entries = ALL_ENTRIES,
  locale = "en",
  extra,
}: { workspace?: StaffWorkspace; permissions?: Permission[]; entries?: WorkspaceEntries; locale?: "en" | "vi"; extra?: ReactNode } = {}) {
  return render(
    <NextIntlClientProvider locale={locale} messages={staffUiTestMessages(locale === "en" ? en : viMessages, locale)}>
      <StaffCommandMenu workspace={workspace} permissions={permissions} entries={entries} />
      {extra}
    </NextIntlClientProvider>,
  );
}

function pressShortcut(init: KeyboardEventInit = { metaKey: true }) {
  act(() => {
    fireEvent.keyDown(window, { key: "k", ...init });
  });
}

async function openPalette() {
  pressShortcut();
  return screen.findByRole("dialog", { name: "Command menu" });
}

function option(name: string | RegExp) {
  return screen.queryByRole("option", { name });
}

describe("StaffCommandMenu trigger", () => {
  it("renders an accessible search trigger without loading the palette", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Search" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("Search…");
    expect(trigger.querySelector("kbd")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows ⌘K on Apple platforms and Ctrl K elsewhere", () => {
    const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    renderMenu();
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-keyshortcuts", "Meta+K");
    expect(screen.getByRole("button", { name: "Search" }).querySelector("kbd")).toHaveTextContent("⌘K");
    cleanup();
    platform.mockReturnValue("Win32");
    renderMenu();
    expect(screen.getByRole("button", { name: "Search" }).querySelector("kbd")).toHaveTextContent("Ctrl K");
  });

  it("opens the lazily loaded dialog from the trigger", async () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const dialog = await screen.findByRole("dialog", { name: "Command menu" });
    expect(within(dialog).getByRole("combobox")).toHaveAttribute("placeholder", "Type a page or action…");
    // The modal hides the rest of the page from assistive tech while open.
    expect(screen.getByRole("button", { name: "Search", hidden: true })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("StaffCommandMenu shortcut", () => {
  it("opens with ⌘K and Ctrl+K and toggles closed on a second press", async () => {
    renderMenu();
    await openPalette();
    pressShortcut({ metaKey: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    pressShortcut({ ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "Command menu" })).toBeInTheDocument();
  });

  it("ignores plain K, modified variants and events another handler already claimed", () => {
    renderMenu();
    pressShortcut({});
    pressShortcut({ metaKey: true, shiftKey: true });
    pressShortcut({ ctrlKey: true, altKey: true });
    const claimed = new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true });
    claimed.preventDefault();
    act(() => {
      window.dispatchEvent(claimed);
    });
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-expanded", "false");
  });

  it("does not open over another modal dialog that has focus", () => {
    renderMenu({
      extra: (
        <div role="dialog" aria-label="Unsaved changes">
          <button type="button">Stay</button>
        </div>
      ),
    });
    screen.getByRole("button", { name: "Stay" }).focus();
    pressShortcut();
    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("StaffCommandDialog content", () => {
  it("lists the workspace navigation with child sections, other workspaces and preferences", async () => {
    renderMenu({ permissions: ["course.read", "content.read", "content.review", "media.upload"] });
    const dialog = await openPalette();
    expect(within(dialog).getByText("Go to")).toBeInTheDocument();
    for (const name of ["Overview", "Courses", "Content library", "Resources", "Media", "Review queue", "Add MCP"]) expect(option(name)).toBeInTheDocument();
    expect(within(dialog).getByText("Workspaces")).toBeInTheDocument();
    expect(option("Assessment & grading")).toBeInTheDocument();
    expect(option("Administration")).toBeInTheDocument();
    // Same list as the sidebar switcher: the active workspace too, marked current.
    expect(screen.getByRole("option", { name: /^Studio\s*Current$/ })).toBeInTheDocument();
    // With no data-theme on a .vf-staff root, "system" is marked as the current choice.
    expect(screen.getByRole("option", { name: /^Use system theme\s*Current$/ })).toBeInTheDocument();
    for (const name of ["Light theme", "Dark theme"]) expect(option(name)).toBeInTheDocument();
  });

  it("respects permissions for navigation, workspaces and quick actions", async () => {
    renderMenu({ permissions: ["course.read"], entries: { studio: "/studio", grading: null, admin: null } });
    const dialog = await openPalette();
    expect(option("Courses")).toBeInTheDocument();
    expect(option("Add MCP")).toBeInTheDocument();
    expect(option("Review queue")).not.toBeInTheDocument();
    expect(option("Question Bank")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Workspaces")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Quick actions")).not.toBeInTheDocument();
    for (const name of ["New course", "Invite member", "Grade next submission"]) expect(option(name)).not.toBeInTheDocument();
  });

  it("offers only the quick actions the permissions allow", async () => {
    renderMenu({ permissions: ["course.read", "course.create"] });
    await openPalette();
    expect(option("New course")).toBeInTheDocument();
    expect(option("Invite member")).not.toBeInTheDocument();
    expect(option("Grade next submission")).not.toBeInTheDocument();
    cleanup();

    renderMenu({ workspace: "admin", permissions: ["admin.access", "member.read", "membership.manage"] });
    await openPalette();
    expect(option("Invite member")).toBeInTheDocument();
    expect(option("New course")).not.toBeInTheDocument();
    cleanup();

    mocks.pathname = "/grading";
    renderMenu({ workspace: "grading", permissions: ["submission.grade"] });
    await openPalette();
    expect(option("Grade next submission")).toBeInTheDocument();
    expect(option("Grading queue")).toBeInTheDocument();
  });

  it("finds Vietnamese items with and without diacritics, and English terms from the other locale", async () => {
    renderMenu({ locale: "vi", permissions: ["course.read", "content.read", "content.review"] });
    pressShortcut({ ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Bảng lệnh" });
    const input = within(dialog).getByRole("combobox");

    fireEvent.change(input, { target: { value: "duyet" } });
    await waitFor(() => expect(option("Hàng đợi duyệt")).toBeInTheDocument());
    expect(option("Khoá học")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "duyệt" } });
    await waitFor(() => expect(option("Hàng đợi duyệt")).toBeInTheDocument());

    fireEvent.change(input, { target: { value: "courses" } });
    await waitFor(() => expect(option("Khoá học")).toBeInTheDocument());
    expect(option("Hàng đợi duyệt")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "giao dien toi" } });
    await waitFor(() => expect(option("Giao diện tối")).toBeInTheDocument());

    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(await within(dialog).findByText("Không có kết quả phù hợp")).toBeInTheDocument();
  });
});

describe("StaffCommandDialog actions", () => {
  it("asks the unsaved-changes guard before router.push and closes", async () => {
    renderMenu();
    await openPalette();
    fireEvent.click(option("Courses")!);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/studio/courses"));
    expect(mocks.requestNavigation).toHaveBeenCalledTimes(1);
    expect(mocks.requestNavigation.mock.invocationCallOrder[0]).toBeLessThan(mocks.push.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("stays put when the guard refuses", async () => {
    mocks.requestNavigation.mockResolvedValue(false);
    renderMenu();
    await openPalette();
    fireEvent.click(option("Assessment & grading")!);
    await waitFor(() => expect(mocks.requestNavigation).toHaveBeenCalled());
    await act(async () => {});
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("links quick actions to their existing routes", async () => {
    renderMenu({ workspace: "admin", permissions: ["admin.access", "membership.manage"] });
    await openPalette();
    fireEvent.click(option("Invite member")!);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/admin/users?invite=1"));
  });

  it("skips the guard when choosing the page already shown", async () => {
    mocks.pathname = "/studio/courses";
    renderMenu();
    await openPalette();
    fireEvent.click(option("Courses")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.requestNavigation).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("applies theme preferences through applyStaffTheme without navigating", async () => {
    renderMenu();
    await openPalette();
    fireEvent.click(option("Dark theme")!);
    expect(mocks.applyStaffTheme).toHaveBeenCalledWith("dark");
    expect(mocks.requestNavigation).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("StaffCommandMenu bundle boundary", () => {
  it("keeps cmdk and the dialog out of the static import graph of the trigger", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(`${process.cwd()}/src/features/staff-ui/ui/StaffCommandMenu.tsx`, "utf8");
    const staticImports = [...source.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]);
    expect(staticImports).not.toContain("cmdk");
    expect(staticImports).not.toContain("@/components/ui/command");
    expect(staticImports).not.toContain("./StaffCommandDialog");
    expect(source).toMatch(/import\(["']\.\/StaffCommandDialog["']\)/);
  });
});
