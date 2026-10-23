// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi as vitest } from "vitest";
import vi from "@/messages/vi.json";
import en from "@/messages/en.json";
import { withBenchMessages } from "@/messages/bench";
import { AppShell } from "@/components/AppShell";
import { GradingShell } from "@/components/GradingShell";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { MobileNavigationDrawer } from "@/components/ShellPrimitives";
import { StudioShell } from "@/components/StudioShell";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";

const allWorkspaces: WorkspaceEntries = { studio: "/studio", grading: "/grading", admin: "/admin" };

const navigationMocks = vitest.hoisted(() => ({ pathname: "/app" }));

vitest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("pathway=ai-emerging-technology&sort=title"),
  usePathname: () => navigationMocks.pathname,
  useRouter: () => ({ push: vitest.fn() }),
}));

function Provider({ children, locale = 'vi' }: { children: React.ReactNode; locale?: 'vi' | 'en' }) {
  return <NextIntlClientProvider locale={locale} messages={withBenchMessages(locale === 'vi' ? vi : en, locale)}>{children}</NextIntlClientProvider>;
}

afterEach(() => {
  cleanup();
  navigationMocks.pathname = "/app";
});

describe("application shells", () => {
  it("renders the focused learner navigation and account menu", () => {
    render(<Provider><AppShell><p>content</p></AppShell></Provider>);
    expect(screen.getByRole("navigation", { name: vi.common.learnerNavigation })).toBeDefined();
    expect(screen.getByRole("link", { name: "Học tập" }).getAttribute("href")).toBe("/app");
    expect(screen.getByRole("link", { name: "Khóa học" }).getAttribute("href")).toBe("/app/courses");
    expect(screen.getByRole("link", { name: "Khám phá" }).getAttribute("href")).toBe("/app/explore");
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Tài khoản' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('menuitem', { name: 'Hồ sơ' })).toHaveAttribute('href', '/app/profile');
  });

  it('uses the real English focus translations for navigation and account destinations', () => {
    render(<Provider locale="en"><AppShell><p>content</p></AppShell></Provider>);
    expect(screen.getByRole('link', { name: 'Learning' })).toHaveAttribute('href', '/app');
    expect(screen.getByRole('link', { name: 'Courses' })).toHaveAttribute('href', '/app/courses');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Account' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('menuitem', { name: 'Certificates' })).toHaveAttribute('href', '/app/profile#certificates-heading');
  });

  it("marks the active learner navigation link with aria-current", () => {
    render(<Provider><AppShell><h1>Home</h1></AppShell></Provider>);

    expect(document.querySelector('nav a[href="/app"]')).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('nav a[href="/app/courses"]')).not.toHaveAttribute("aria-current");
  });

  it("removes global navigation and breadcrumbs in focused item workspaces", () => {
    navigationMocks.pathname = "/app/courses/ai-foundations/items/lesson-1";

    render(<Provider><AppShell><h1>Lesson</h1></AppShell></Provider>);

    expect(screen.queryByRole('navigation', { name: vi.common.learnerNavigation })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Đường dẫn trang" })).toBeNull();
  });

  it('moves focus to the learner page heading after client navigation', () => {
    render(<Provider><AppShell><h1>Trang học</h1></AppShell></Provider>);

    expect(screen.getByRole('heading', { name: 'Trang học' })).toHaveFocus();
  });

  it("renders content authoring destinations in Studio and no grading or reporting entry", () => {
    render(<Provider><StudioShell entries={allWorkspaces} permissions={['course.read', 'bank.edit', 'media.upload', 'submission.grade', 'exam.release', 'resource.edit', 'opportunity.edit', 'project.edit', 'user.manage.global', 'admin.access', 'analytics.global.read']}><p>content</p></StudioShell></Provider>);
    expect(screen.getAllByRole("navigation", { name: vi.common.studioNavigation }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Khoá học" }).every((link) => link.getAttribute("href") === "/studio/courses")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Thư viện nội dung" }).every((link) => link.getAttribute("href") === "/studio/library")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Ngân hàng câu hỏi" }).every(link=>link.getAttribute("href")==="/studio/bank")).toBe(true);
    expect(screen.queryByRole("link", { name: "Chấm điểm" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Báo cáo học tập" })).toBeNull();
  });

  it("offers every authorized workspace from the server-resolved entries", () => {
    render(<Provider><StudioShell entries={allWorkspaces} permissions={['course.read']}><p>content</p></StudioShell></Provider>);

    const switchers = screen.getAllByRole("navigation", { name: vi.common.workspaces });
    expect(switchers.length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Khảo thí & đánh giá" }).every(link=>link.getAttribute("href")==="/grading")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Quản trị" }).every(link=>link.getAttribute("href")==="/admin")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Studio" })[0]).toHaveAttribute("aria-current", "page");
  });

  it("never invents a workspace the server did not authorize", () => {
    render(<Provider><StudioShell entries={{ studio: "/studio", grading: null, admin: null }} permissions={['course.read', 'submission.grade', 'admin.access']}><p>content</p></StudioShell></Provider>);

    expect(screen.queryByRole("navigation", { name: vi.common.workspaces })).toBeNull();
    expect(screen.queryByRole("link", { name: "Khảo thí & đánh giá" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Quản trị" })).toBeNull();
  });

  it("renders the Assessment & grading shell with its own navigation and scope endpoint", () => {
    navigationMocks.pathname = "/grading/queue";
    render(<Provider><GradingShell entries={allWorkspaces} permissions={['submission.grade', 'exam.release', 'report.branch.read']}><p>content</p></GradingShell></Provider>);

    expect(screen.getAllByRole("navigation", { name: vi.common.gradingNavigation }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Đánh giá" }).every(link=>link.getAttribute("href")==="/grading/assessments")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Hàng đợi chấm điểm" }).every(link=>link.getAttribute("href")==="/grading/queue")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Báo cáo học tập" }).every(link=>link.getAttribute("href")==="/grading/reports")).toBe(true);
    expect(document.querySelector('nav a[href="/grading/queue"]')).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("link", { name: "Khảo thí & đánh giá" })[0]).toHaveAttribute("aria-current", "page");
  });

  it("omits grading destinations a report-only operator cannot reach", () => {
    navigationMocks.pathname = "/grading/reports";
    render(<Provider><GradingShell entries={{ studio: null, grading: "/grading", admin: null }} permissions={['report.branch.read']}><p>content</p></GradingShell></Provider>);

    expect(screen.getAllByRole("link", { name: "Báo cáo học tập" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Hàng đợi chấm điểm" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Đánh giá" })).toBeNull();
  });

  it('omits Studio destinations the server-provided permissions do not grant', () => {
    navigationMocks.pathname = "/studio/courses";
    render(<Provider><StudioShell permissions={['bank.edit']}><p>content</p></StudioShell></Provider>);

    expect(screen.getAllByRole('link', { name: 'Ngân hàng câu hỏi' }).every(link=>link.getAttribute('href')==='/studio/bank')).toBe(true);
    expect(screen.queryByRole('link', { name: 'Khoá học' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Thư viện' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Bài nộp' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Kỳ thi' })).toBeNull();
  });

  it("marks a nested Studio section active without also activating its dashboard", () => {
    navigationMocks.pathname = "/studio/courses/ai-foundations";
    render(<Provider><StudioShell permissions={['course.read']}><h1>Course workspace</h1></StudioShell></Provider>);

    expect(document.querySelector('nav a[href="/studio/courses"]')).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('nav a[href="/studio"]')).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("navigation", { name: "Đường dẫn trang" })).toBeNull();
  });

  it('uses the compact top bar only for a course workspace', () => {
    navigationMocks.pathname = '/studio/courses/ai-foundations';
    render(<Provider><StudioShell permissions={['course.read', 'bank.edit']}><h1>Course workspace</h1></StudioShell></Provider>);

    expect(document.querySelector('aside')).toHaveClass('hidden');
    expect(screen.queryByRole('navigation', { name: 'Đường dẫn trang' })).toBeNull();
  });

  it("offers the learner every staff workspace the server resolved", () => {
    render(<Provider><AppShell studioDestination="/studio" gradingDestination="/grading" adminDestination="/admin" userName="An"><h1>Dashboard</h1></AppShell></Provider>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'An' }), { button: 0, ctrlKey: false });

    expect(screen.getByRole('menuitem', { name: 'Mở Studio' })).toHaveAttribute('href', '/studio');
    expect(screen.getByRole('menuitem', { name: 'Mở Khảo thí & đánh giá' })).toHaveAttribute('href', '/grading');
    expect(screen.getByRole('menuitem', { name: 'Mở Quản trị' })).toHaveAttribute('href', '/admin');
  });

  it("shows workspace switching only when the server grants Studio access", () => {
    const { rerender } = render(<Provider><AppShell><h1>Dashboard</h1></AppShell></Provider>);
    expect(screen.queryByRole("link", { name: "Mở Studio" })).toBeNull();

    rerender(<Provider><AppShell canAccessStudio userName="An"><h1>Dashboard</h1></AppShell></Provider>);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'An' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole("menuitem", { name: "Mở Studio" })).toHaveAttribute("href", "/studio");
    expect(screen.getByRole("menuitem", { name: "Hồ sơ" })).toHaveAttribute("href", "/app/profile");
    expect((screen.getByRole("menuitem", { name: "Đăng xuất" }) as HTMLButtonElement).form).toHaveAttribute("action", "/auth/signout");
  });

  it("opens an accessible mobile drawer and restores trigger focus on Escape", async () => {
    render(<Provider><AppShell><h1>Dashboard</h1></AppShell></Provider>);
    const trigger = screen.getByRole("button", { name: "Mở menu" });
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Điều hướng học viên" })).toBeInTheDocument();
    expect(screen.getAllByRole("navigation", { name: "Điều hướng học viên" })).toHaveLength(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Điều hướng học viên" })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes the shared drawer without focusing a hidden trigger when the viewport becomes desktop', async () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vitest.fn(() => ({
      matches: false,
      media: '(min-width: 64rem)',
      onchange: null,
      addEventListener: (_type: string, callback: EventListenerOrEventListenerObject | null) => { listener = callback as (event: MediaQueryListEvent) => void; },
      removeEventListener: vitest.fn(),
      addListener: vitest.fn(),
      removeListener: vitest.fn(),
      dispatchEvent: vitest.fn(),
    })) });
    render(<Provider><AppShell><h1>Dashboard</h1></AppShell></Provider>);
    const trigger = screen.getByRole('button', { name: 'Mở menu' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Điều hướng học viên' })).toBeInTheDocument();

    // The learner bar shows its own nav from 760px, so the drawer closes there (staff bars keep 64rem).
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 47.5rem)');
    listener?.({ matches: true } as MediaQueryListEvent);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).not.toHaveFocus();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  });

  it('keeps the staff drawer breakpoint at 64rem by default', () => {
    const originalMatchMedia = window.matchMedia;
    const matchMedia = vitest.fn(() => ({ matches: false, addEventListener: vitest.fn(), removeEventListener: vitest.fn() }));
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia });
    render(<Provider><MobileNavigationDrawer id="staff-drawer" open onOpenChange={vitest.fn()} title="Menu" returnFocusRef={{ current: null }}><p>links</p></MobileNavigationDrawer></Provider>);
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 64rem)');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
  });

  it('bounds a long account name while keeping the full accessible name', () => {
    const name = 'A very long learner account name that must remain accessible';
    render(<Provider><AppShell userName={name}><h1>Dashboard</h1></AppShell></Provider>);
    const trigger = screen.getByRole('button', { name });
    expect(trigger).toHaveAttribute('title', name);
    expect(trigger).toHaveClass('vf-l-account-trigger');
    expect(trigger.querySelector('.vf-l-account-name')).toHaveClass('truncate');
  });

  it('includes all account destinations in the mobile drawer', () => {
    render(<Provider><AppShell canAccessStudio><h1>Dashboard</h1></AppShell></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Mở menu' }));
    expect(screen.getByRole('link', { name: 'Hồ sơ' })).toHaveAttribute('href', '/app/profile');
    expect(screen.getByRole('link', { name: 'Chứng chỉ' })).toHaveAttribute('href', '/app/profile#certificates-heading');
    expect(screen.getByRole('link', { name: 'XP' })).toHaveAttribute('href', '/app/profile#xp-heading');
    expect(screen.getByRole('link', { name: 'Bảng xếp hạng' })).toHaveAttribute('href', '/app/leaderboard');
    expect(screen.getByRole('link', { name: 'Mở Studio' })).toHaveAttribute('href', '/studio');
  });

  it("renders public locale links that opt into the lang query contract", () => {
    render(<Provider><LocaleSwitcher variant="links" /></Provider>);

    expect(screen.getByRole("link", { name: "English" }).getAttribute("href")).toBe(
      "?pathway=ai-emerging-technology&sort=title&lang=en",
    );
    expect(screen.getByRole("link", { name: "Tiếng Việt" }).getAttribute("href")).toBe(
      "?pathway=ai-emerging-technology&sort=title&lang=vi",
    );
  });
});

describe("staff routing context", () => {
  it("keeps Content library active with a section crumb while editing a resource", () => {
    navigationMocks.pathname = "/studio/resources/resource-1";
    render(<Provider><StudioShell permissions={['resource.edit']}><h1>Resource</h1></StudioShell></Provider>);
    expect(document.querySelector('nav a[href="/studio/library"]')).toHaveAttribute("aria-current", "page");
    const crumbs = screen.getByRole("navigation", { name: vi.common.breadcrumbs });
    expect(crumbs).toHaveTextContent(vi.studioNav.library);
    expect(crumbs).toHaveTextContent(vi.studioNav.resources);
  });

  it("keeps the grading queue active inside a submission workbench", () => {
    navigationMocks.pathname = "/grading/assignments/submission-1";
    render(<Provider><GradingShell permissions={['submission.grade']}><h1>Workbench</h1></GradingShell></Provider>);
    expect(document.querySelector('nav a[href="/grading/queue"]')).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('nav a[href="/grading"]')).not.toHaveAttribute("aria-current");
  });

  it("offers an Overview entry that is active only on the workspace home", () => {
    navigationMocks.pathname = "/grading";
    render(<Provider><GradingShell permissions={['submission.grade']}><h1>Home</h1></GradingShell></Provider>);
    expect(document.querySelector('nav a[href="/grading"]')).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('nav a[href="/grading/queue"]')).not.toHaveAttribute("aria-current");
  });
});
