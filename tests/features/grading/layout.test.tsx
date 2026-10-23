// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({
  gradingPageContext: vi.fn(),
  readStaffChrome: vi.fn(),
  loginDestination: vi.fn(),
  forbidden: vi.fn(() => { throw new Error('forbidden:403'); }),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock('@/features/admin/components/AdminSessionGuard', () => ({
  AdminSessionGuard: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  forbidden: mocks.forbidden,
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/grading/queue',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/workspace/context', () => ({ gradingPageContext: mocks.gradingPageContext }));
vi.mock('@/features/staff-ui/chrome.server', () => ({ readStaffChrome: mocks.readStaffChrome }));
vi.mock('@/lib/auth', () => ({ loginDestination: mocks.loginDestination }));

import GradingLayout from '@/app/grading/layout';
import GradingForbiddenPage from '@/app/grading/forbidden';

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={staffUiTestMessages(en, 'en')}>{children}</NextIntlClientProvider>;
}

describe('Assessment & grading layout gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readStaffChrome.mockResolvedValue({ theme: 'system', sidebarOpen: true, identity: { name: 'Grader', email: 'grader@example.test', avatarUrl: null, initials: 'GR' } });
    mocks.gradingPageContext.mockResolvedValue({
      workspace: 'grading',
      actor: { userId: 'teacher-1', roles: [] },
      scope: { kind: 'branch', branchId: 'school-a' },
      options: [], branches: [],
      permissions: ['submission.grade', 'exam.release'],
      entries: { studio: null, grading: '/grading', admin: null },
    });
  });
  afterEach(cleanup);

  it('redirects an unauthenticated visitor to login with the grading return path', async () => {
    mocks.loginDestination.mockResolvedValue('/login?next=%2Fgrading%2Fqueue');
    mocks.gradingPageContext.mockImplementationOnce(async () => {
      mocks.redirect(await mocks.loginDestination());
    });

    await expect(GradingLayout({ children: <p>Protected</p> }))
      .rejects.toThrow('redirect:/login?next=%2Fgrading%2Fqueue');
  });

  it('renders the grading shell and its authorized destinations', async () => {
    render(<Provider>{await GradingLayout({ children: <p>Protected</p> })}</Provider>);

    expect(screen.getAllByRole('navigation', { name: 'Assessment & grading navigation' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Grading queue' })[0]).toHaveAttribute('href', '/grading/queue');
    expect(screen.getAllByRole('link', { name: 'Assessments' })[0]).toHaveAttribute('href', '/grading/assessments');
    expect(screen.queryByRole('link', { name: 'Learning reports' })).not.toBeInTheDocument();
    expect(screen.getByText('Protected')).toBeInTheDocument();
  });

  it('shows only reports for a report-only operator', async () => {
    mocks.gradingPageContext.mockResolvedValue({
      workspace: 'grading',
      actor: { userId: 'analyst-1', roles: [] },
      scope: { kind: 'branch', branchId: 'school-b' },
      options: [], branches: [],
      permissions: ['report.branch.read'],
      entries: { studio: null, grading: '/grading', admin: null },
    });

    render(<Provider>{await GradingLayout({ children: <p>Protected</p> })}</Provider>);

    expect(screen.getAllByRole('link', { name: 'Learning reports' })[0]).toHaveAttribute('href', '/grading/reports');
    expect(screen.queryByRole('link', { name: 'Grading queue' })).not.toBeInTheDocument();
  });

  it('offers no workspace switcher when grading is the only authorized workspace', async () => {
    render(<Provider>{await GradingLayout({ children: <p>Protected</p> })}</Provider>);

    expect(screen.queryByRole('navigation', { name: 'Workspaces' })).not.toBeInTheDocument();
  });

  it('offers the other authorized workspaces by their landing pages', async () => {
    mocks.gradingPageContext.mockResolvedValue({
      workspace: 'grading',
      actor: { userId: 'lead-1', roles: [] },
      scope: { kind: 'branch', branchId: 'school-a' },
      options: [], branches: [],
      permissions: ['submission.grade'],
      entries: { studio: '/studio', grading: '/grading', admin: '/admin' },
    });

    render(<Provider>{await GradingLayout({ children: <p>Protected</p> })}</Provider>);

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Assessment & grading' }), { button: 0, ctrlKey: false });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Studio' })).toHaveAttribute('href', '/studio');
    expect(within(menu).getByRole('menuitem', { name: 'Administration' })).toHaveAttribute('href', '/admin');
    expect(within(menu).getByRole('menuitem', { name: 'Assessment & grading' })).toHaveAttribute('aria-current', 'true');
  });

  it('renders the bilingual forbidden fallback', () => {
    render(<Provider><GradingForbiddenPage /></Provider>);

    expect(screen.getByRole('heading', { name: 'Studio access required' })).toBeInTheDocument();
    expect(screen.getByText('Bạn không có quyền truy cập Studio.')).toBeInTheDocument();
  });
});
