// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  router: { replace: vi.fn(), refresh: vi.fn() },
  subscribe: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  readWorkspaceTheme: vi.fn(),
  loginDestination: vi.fn(),
  learnerIdentity: vi.fn(async () => ({ name: 'Nguyễn An', initials: 'NA', handle: 'an-nguyen' })),
  redirect: vi.fn((destination: string) => { throw new Error(`redirect:${destination}`); }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => mocks.router }));
vi.mock('@/lib/supabase/client', () => ({ supabaseBrowser: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  getActor: mocks.getActor,
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-nonce': 'layout-request-nonce' }) }));
vi.mock('@/lib/auth', () => ({ loginDestination: mocks.loginDestination }));
vi.mock('@/features/workspace-ui/theme.server', () => ({ readWorkspaceTheme: mocks.readWorkspaceTheme }));
vi.mock('@/features/workspace-ui/identity.server', () => ({ learnerIdentity: mocks.learnerIdentity }));
vi.mock('@/components/AppShell', () => ({
  AppShell: ({ children, studioDestination, gradingDestination, adminDestination, theme, userName, initials, handle }: { children: React.ReactNode; studioDestination?: string | null; gradingDestination?: string | null; adminDestination?: string | null; theme?: string; userName?: string; initials?: string; handle?: string }) => (
    <div data-testid="app-shell" data-studio={String(studioDestination)} data-grading={String(gradingDestination)} data-admin={String(adminDestination)} data-theme={theme} data-user-name={userName} data-initials={initials} data-handle={handle}>{children}</div>
  ),
}));

import LearnerLayout from '@/app/app/layout';

function view(layout: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{layout}</NextIntlClientProvider>);
}

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = join(directory, entry.name);
    return entry.isDirectory() ? pageFiles(child) : entry.name === 'page.tsx' ? [child] : [];
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('learner application layout', () => {
  it('guards the actual learner shell against another tab changing the server actor', async () => {
    vi.stubEnv('NEXT_PUBLIC_ACADEMY_BACKEND', 'azure');
    mocks.getActor.mockResolvedValue({ userId: 'learner-1', roles: [] });
    mocks.readWorkspaceTheme.mockResolvedValue('dark');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ userId: 'learner-1' })).mockResolvedValue(Response.json({ userId: 'learner-2' })));
    const layout = await LearnerLayout({ children: <p>Original learner answers</p> });
    await act(async () => { view(layout); });
    expect(screen.getByText('Original learner answers')).toBeVisible();
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'vfuture:auth:changed', newValue: 'new-login' })); });
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    expect(screen.queryByText('Original learner answers')).not.toBeInTheDocument();
    expect(mocks.router.replace).toHaveBeenCalledWith('/app');
  });

  it('renders the learner shell with the saved theme', async () => {
    mocks.getActor.mockResolvedValue({ userId: 'learner-1', roles: [] });
    mocks.readWorkspaceTheme.mockResolvedValue('dark');

    view(await LearnerLayout({ children: <p>content</p> }));

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark');
  });

  it('passes the learner identity to the shell', async () => {
    mocks.getActor.mockResolvedValue({ userId: 'learner-1', roles: [] });
    mocks.readWorkspaceTheme.mockResolvedValue('system');

    view(await LearnerLayout({ children: <p>content</p> }));

    const shell = screen.getByTestId('app-shell');
    expect(shell).toHaveAttribute('data-user-name', 'Nguyễn An');
    expect(shell).toHaveAttribute('data-initials', 'NA');
    expect(shell).toHaveAttribute('data-handle', 'an-nguyen');
  });

  it('offers Assessment & grading independently for a grading-only role', async () => {
    mocks.getActor.mockResolvedValue({
      userId: 'teacher', roles: [], authorization: {
        source: 'database', accountStatus: 'active',
        memberships: [{ branchId: 'school-a', status: 'active' }],
        assignments: [{ roleDefinitionId: 'teacher', scope: { kind: 'branch', branchId: 'school-a' }, permissions: ['submission.grade'] }],
      },
    });

    view(await LearnerLayout({ children: <p>content</p> }));

    const shell = screen.getByTestId('app-shell');
    expect(shell).toHaveAttribute('data-grading', '/grading');
    expect(shell).toHaveAttribute('data-studio', 'null');
    expect(shell).toHaveAttribute('data-admin', 'null');
  });

  it('offers only learning reports for a report-only role', async () => {
    mocks.getActor.mockResolvedValue({
      userId: 'analyst', roles: [], authorization: {
        source: 'database', accountStatus: 'active',
        memberships: [{ branchId: 'school-a', status: 'active' }],
        assignments: [{ roleDefinitionId: 'analyst', scope: { kind: 'branch', branchId: 'school-a' }, permissions: ['report.branch.read'] }],
      },
    });

    view(await LearnerLayout({ children: <p>content</p> }));

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-grading', '/grading');
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-admin', 'null');
  });

  it('requires authentication before rendering the learner shell', async () => {
    mocks.getActor.mockResolvedValue(null);
    mocks.loginDestination.mockResolvedValue('/login?next=%2Fapp%2Fcourses%2Fcourse-1');

    await expect(LearnerLayout({ children: <p>learner content</p> }))
      .rejects.toThrow('redirect:/login?next=%2Fapp%2Fcourses%2Fcourse-1');
  });

  it('derives every workspace destination on the server and owns the only learner shell', async () => {
    mocks.getActor.mockResolvedValue({
      userId: 'learner-1', roles: [], authorization: {
        source: 'database', accountStatus: 'active',
        memberships: [{ branchId: 'school-a', status: 'active' }],
        assignments: [
          { roleDefinitionId: 'editor', scope: { kind: 'central' }, permissions: ['course.read', 'content.read'] },
          { roleDefinitionId: 'lead', scope: { kind: 'branch', branchId: 'school-a' }, permissions: ['admin.access', 'member.read', 'submission.grade'] },
        ],
      },
    });

    view(await LearnerLayout({ children: <p>learner content</p> }));

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-studio', '/studio');
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-grading', '/grading');
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-admin', '/admin');
    expect(screen.getByText('learner content')).toBeInTheDocument();

    for (const file of pageFiles(join(process.cwd(), 'src/app/app'))) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('AppShell');
    }
  });
});
