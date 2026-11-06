// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

vitest.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useSearchParams: () => new URLSearchParams("pathway=ai-emerging-technology&sort=title"),
  usePathname: () => navigationMocks.pathname,
  useRouter: () => ({ push: vitest.fn() }),
}));

function Provider({ children, locale = 'vi' }: { children: React.ReactNode; locale?: 'vi' | 'en' }) {
  return <NextIntlClientProvider locale={locale} messages={withBenchMessages(locale === 'vi' ? vi : en, locale)}>{children}</NextIntlClientProvider>;
}

afterEach(() => {
  cleanup();
  vitest.restoreAllMocks();
  navigationMocks.pathname = "/app";
});

describe("application shells", () => {
  it("renders the focused learner navigation and one shared Account tray", async () => {
    render(<Provider><AppShell><p>content</p></AppShell></Provider>);
    expect(screen.getByRole("navigation", { name: "Điều hướng toàn cục" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Tổng quan" }).getAttribute("href")).toBe("/app");
    expect(screen.getByRole("button", { name: "Khóa học" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByRole("link", { name: "Khám phá" }).getAttribute("href")).toBe("/app/explore");
    expect(screen.getAllByRole('button', { name: 'Tài khoản' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    const tray = await screen.findByRole('dialog', { name: 'Tài khoản' });
    expect(within(tray).getByRole('link', { name: 'Hồ sơ' })).toHaveAttribute('href', '/app/profile');
    expect(screen.getAllByRole('dialog', { name: 'Tài khoản' })).toHaveLength(1);
  });

  it('uses the real English focus translations for navigation and account destinations', async () => {
    render(<Provider locale="en"><AppShell><p>content</p></AppShell></Provider>);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/app');
    expect(screen.getByRole('button', { name: 'Courses' })).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    const tray = await screen.findByRole('dialog', { name: 'Account' });
    expect(within(tray).getByRole('link', { name: 'Certificates' })).toHaveAttribute('href', '/app/profile#certificates-heading');
  });

  it("marks the active learner navigation link with aria-current", () => {
    render(<Provider><AppShell><h1>Home</h1></AppShell></Provider>);

    const navigation = screen.getByRole('navigation', { name: 'Điều hướng toàn cục' });
    expect(within(navigation).getByRole('link', { name: 'Tổng quan' })).toHaveAttribute('aria-current', 'page');
    expect(within(navigation).getByRole('button', { name: 'Khóa học' })).not.toHaveAttribute('aria-current');
  });

  it("keeps the global rail in focused item workspaces", () => {
    navigationMocks.pathname = "/app/courses/ai-foundations/items/lesson-1";

    render(<Provider><AppShell><h1>Lesson</h1></AppShell></Provider>);

    expect(screen.getByRole('navigation', { name: 'Điều hướng toàn cục' })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Đường dẫn trang" })).toBeNull();
  });

  it('moves focus to the learner page heading after client navigation', () => {
    render(<Provider><AppShell><h1 tabIndex={-1}>Trang học</h1></AppShell></Provider>);

    expect(screen.getByRole('heading', { name: 'Trang học' })).toHaveFocus();
  });

  it.each(['/app/resources/research', '/app/opportunities/open', '/app/projects/project-1'])('keeps Explore active for %s', (pathname) => {
    navigationMocks.pathname = pathname;
    render(<Provider><AppShell><h1>Discovery detail</h1></AppShell></Provider>);
    expect(document.querySelector('nav li a[href="/app/explore"]')).toHaveAttribute('aria-current', 'page');
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

  it("offers the learner every staff workspace the server resolved in global navigation", async () => {
    render(<Provider><AppShell studioDestination="/studio" gradingDestination="/grading" adminDestination="/admin" userName="An"><h1>Dashboard</h1></AppShell></Provider>);
    const navigation = screen.getByRole('navigation', { name: 'Điều hướng toàn cục' });
    expect(within(navigation).getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/studio');
    expect(within(navigation).getByRole('link', { name: 'Giảng dạy' })).toHaveAttribute('href', '/grading');
    expect(within(navigation).getByRole('link', { name: 'Quản trị' })).toHaveAttribute('href', '/admin');
    fireEvent.click(within(navigation).getByRole('button', { name: 'Tài khoản' }));
    const tray = await screen.findByRole('dialog', { name: 'Tài khoản' });
    expect(within(tray).getByRole('heading', { name: 'An' })).toBeInTheDocument();
    for (const href of ['/studio', '/grading', '/admin']) expect(tray.querySelector(`a[href="${href}"]`)).toBeNull();
  });

  it("shows the Studio destination only when the server grants Studio access", async () => {
    const { rerender } = render(<Provider><AppShell><h1>Dashboard</h1></AppShell></Provider>);
    expect(screen.queryByRole("link", { name: "Studio" })).toBeNull();

    rerender(<Provider><AppShell canAccessStudio userName="An"><h1>Dashboard</h1></AppShell></Provider>);
    expect(screen.getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/studio');
    fireEvent.click(screen.getByRole('button', { name: 'Tài khoản' }));
    const tray = await screen.findByRole('dialog', { name: 'Tài khoản' });
    expect(within(tray).getByRole('link', { name: 'Hồ sơ' })).toHaveAttribute('href', '/app/profile');
    expect(within(tray).getByRole('button', { name: 'Đăng xuất' }).tagName).toBe('BUTTON');
    const signoutForm = document.querySelector('form[action="/auth/signout"]');
    expect(signoutForm).toHaveAttribute('method', 'post');
    expect(signoutForm).toHaveAttribute('hidden');
  });

  it("opens an accessible mobile drawer and restores trigger focus on Escape", async () => {
    render(<Provider><AppShell><h1>Dashboard</h1></AppShell></Provider>);
    const trigger = screen.getByRole("button", { name: "Mở menu" });
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Điều hướng học viên" })).toBeInTheDocument();
    expect(screen.getAllByRole("navigation", { name: "Điều hướng toàn cục" })).toHaveLength(1);
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

    // Canvas global navigation appears from 768px; the drawer closes at the same breakpoint.
    expect(window.matchMedia).toHaveBeenCalledWith('(min-width: 48rem)');
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

  it('keeps the full long identity and name-derived Avatar inside the bounded Account panel', async () => {
    const name = 'A very long learner account name that must remain accessible';
    render(<Provider><AppShell userName={name}><h1>Dashboard</h1></AppShell></Provider>);
    const trigger = screen.getByRole('button', { name: 'Tài khoản' });
    expect(trigger).toHaveAccessibleName('Tài khoản');
    fireEvent.click(trigger);
    const tray = await screen.findByRole('dialog', { name: 'Tài khoản' });
    const identity = within(tray).getByRole('heading', { name });
    expect(identity).toHaveTextContent(name);
    expect(identity.closest('.canvas-account-identity')).not.toBeNull();
    expect(tray.querySelector('.canvas-account-panel')).toBeInTheDocument();
    expect(tray.querySelector('.canvas-account-avatar')).toHaveTextContent('RA');
  });

  it('hands mobile navigation to the single Account tray with every actual account destination', async () => {
    render(<Provider><AppShell canAccessStudio><h1>Dashboard</h1></AppShell></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'Mở menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Điều hướng học viên' });
    expect(within(drawer).getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/studio');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Tài khoản' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Điều hướng học viên' })).not.toBeInTheDocument());
    const tray = await screen.findByRole('dialog', { name: 'Tài khoản' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(tray).getByRole('link', { name: 'Hồ sơ' })).toHaveAttribute('href', '/app/profile');
    expect(within(tray).getByRole('link', { name: 'Chứng chỉ' })).toHaveAttribute('href', '/app/profile#certificates-heading');
    expect(within(tray).getByRole('link', { name: 'Cài đặt tài khoản' })).toHaveAttribute('href', '/app/profile#profile-settings-heading');
    expect(within(tray).getByRole('link', { name: 'Bảng xếp hạng' })).toHaveAttribute('href', '/app/leaderboard');
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
