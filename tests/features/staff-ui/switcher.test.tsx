// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceScopeSwitcher, type WorkspaceScopeSwitcherProps } from "@/features/staff-ui/ui/WorkspaceScopeSwitcher";
import type { AdminScopeOption } from "@/lib/admin-scope";
import { registerNavigationGuard } from "@/lib/navigation-guard";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import en from "@/messages/en.json";
import vi_ from "@/messages/vi.json";
import { staffUiTestMessages } from "@/messages/staff-ui";

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/studio" }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const ALL: WorkspaceEntries = { studio: "/studio", grading: "/grading", admin: "/admin" };
const STUDIO_ONLY: WorkspaceEntries = { studio: "/studio", grading: null, admin: null };
const options: AdminScopeOption[] = [
  { scope: { kind: "central" }, label: "Central", permissions: [] },
  { scope: { kind: "branch", branchId: "ans" }, label: "ANS", permissions: [] },
  { scope: { kind: "branch", branchId: "dewey" }, label: "Dewey", permissions: [] },
];

function view(props: Partial<WorkspaceScopeSwitcherProps> = {}, { locale = "en" as "en" | "vi", open = true } = {}) {
  const base = locale === "en" ? en : vi_;
  return render(
    <NextIntlClientProvider locale={locale} messages={staffUiTestMessages(base, locale)}>
      <SidebarProvider defaultOpen={open}>
        <WorkspaceScopeSwitcher
          workspace="studio"
          entries={ALL}
          scopeOptions={options}
          activeScope={options[1].scope}
          {...props}
        />
      </SidebarProvider>
    </NextIntlClientProvider>,
  );
}

function trigger() {
  // The switcher is the only button it renders.
  return screen.getByRole("button");
}

function openMenu() {
  fireEvent.pointerDown(trigger(), { button: 0, ctrlKey: false });
  return screen.getByRole("menu");
}

describe("WorkspaceScopeSwitcher", () => {
  it("names the workspace and the localized active scope with the brand tile", () => {
    view({ activeScope: options[0].scope });
    const button = trigger();
    expect(button).toHaveTextContent("Studio");
    expect(button).toHaveTextContent(en.centralAdmin.central);
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(within(button).getByText("VF")).toHaveClass("bg-brand", "text-brand-foreground", "size-8", "rounded-md");
  });

  it("uses the Vietnamese workspace label", () => {
    view({ workspace: "grading" }, { locale: "vi" });
    const button = screen.getByRole("button", { name: /Khảo thí & đánh giá/ });
    expect(button).toHaveTextContent("ANS");
  });

  it("keeps workspace and scope in the accessible name in the collapsed rail", () => {
    view({}, { open: false });
    expect(screen.getByRole("button", { name: /Studio.*ANS/ })).toBeInTheDocument();
  });

  it("lists only authorized workspaces with their landing hrefs and marks the current one", () => {
    view({ entries: { studio: "/studio", grading: null, admin: "/admin" } });
    const menu = openMenu();
    const group = within(menu).getByText(en.common.workspaces).closest("[role=group]") as HTMLElement;
    const links = within(group).getAllByRole("menuitem");
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      [en.common.workspaceStudio, "/studio"],
      [en.common.workspaceAdmin, "/admin"],
    ]);
    expect(within(menu).queryByRole("menuitem", { name: en.common.workspaceGrading })).not.toBeInTheDocument();
    expect(links[0]).toHaveAttribute("aria-current", "true");
    expect(links[1]).not.toHaveAttribute("aria-current");
  });

  it("offers every scope as a radio group with the active one checked", () => {
    view();
    const menu = openMenu();
    const radios = within(menu).getAllByRole("menuitemradio");
    expect(radios.map((radio) => radio.textContent)).toEqual([en.centralAdmin.central, "ANS", "Dewey"]);
    expect(radios[1]).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByText(en.centralAdmin.scope)).toBeInTheDocument();
    expect(within(menu).getAllByRole("separator")).toHaveLength(1);
  });

  it("hides the workspace group with a single workspace but keeps the scopes", () => {
    view({ entries: STUDIO_ONLY });
    const menu = openMenu();
    expect(within(menu).queryByRole("menuitem")).not.toBeInTheDocument();
    expect(within(menu).queryByRole("separator")).not.toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(3);
  });

  it("renders a static header for one workspace and one scope", () => {
    view({ entries: STUDIO_ONLY, scopeOptions: [options[1]] });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Studio")).toBeInTheDocument();
    expect(screen.getByText("ANS")).toBeInTheDocument();
  });

  it("renders a static header for one workspace without scopes", () => {
    view({ entries: STUDIO_ONLY, scopeOptions: undefined, activeScope: undefined });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Studio")).toBeInTheDocument();
  });

  it("portals the menu with the canonical popover surface so it follows the staff theme", () => {
    const { container } = view();
    const menu = openMenu();
    expect(container.contains(menu)).toBe(false);
    expect(menu).toHaveClass("bg-popover", "text-popover-foreground", "border-border");
  });

  it("persists the chosen scope then replaces and refreshes the workspace", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    view({ workspace: "grading" });
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Dewey" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/grading"));
    expect(nav.refresh).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith(
      "/api/v1/grading/scope",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal), body: JSON.stringify({ scope: "branch:dewey" }) }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(en.centralAdmin.switchingScope);
  });

  it("does nothing when the active scope is chosen again", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    view();
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "ANS" }));
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the scope when the unsaved-changes guard cancels", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const guard = vi.fn(async () => false);
    const unregister = registerNavigationGuard(guard);
    try {
      view();
      const menu = openMenu();
      fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Dewey" }));
      await waitFor(() => expect(guard).toHaveBeenCalled());
      await act(async () => {});
      expect(request).not.toHaveBeenCalled();
      expect(nav.replace).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(trigger()).toHaveTextContent("ANS");
      expect(trigger()).not.toHaveAttribute("aria-busy");
    } finally {
      unregister();
    }
  });

  it("announces a rejected scope without navigating", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    view({ workspace: "admin" });
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Dewey" }));
    const message = await screen.findByText(en.centralAdmin.scopeError);
    expect(message.closest("[aria-live]")).toHaveAttribute("aria-live", "polite");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(trigger()).toHaveTextContent("ANS");
  });
});
