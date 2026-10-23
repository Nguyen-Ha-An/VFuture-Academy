// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  readWorkspaceTheme: vi.fn(),
  loginDestination: vi.fn(),
  learnerIdentity: vi.fn(async () => ({ name: 'Nguyễn An', initials: 'NA', handle: 'an-nguyen' })),
  redirect: vi.fn((destination: string) => { throw new Error(`redirect:${destination}`); }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/permissions')>()),
  getActor: mocks.getActor,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ loginDestination: mocks.loginDestination }));
vi.mock('@/features/workspace-ui/theme.server', () => ({ readWorkspaceTheme: mocks.readWorkspaceTheme }));
vi.mock('@/features/workspace-ui/identity.server', () => ({ learnerIdentity: mocks.learnerIdentity }));
vi.mock('@/components/AppShell', () => ({
  AppShell: ({ children, studioDestination, gradingDestination, adminDestination, theme, userName, initials, handle }: { children: React.ReactNode; studioDestination?: string | null; gradingDestination?: string | null; adminDestination?: string | null; theme?: string; userName?: string; initials?: string; handle?: string }) => (
    <div data-testid="app-shell" data-studio={String(studioDestination)} data-grading={String(gradingDestination)} data-admin={String(adminDestination)} data-theme={theme} data-user-name={userName} data-initials={initials} data-handle={handle}>{children}</div>
  ),
}));

import LearnerLayout from '@/app/app/layout';

function pageFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = join(directory, entry.name);
    return entry.isDirectory() ? pageFiles(child) : entry.name === 'page.tsx' ? [child] : [];
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('learner application layout', () => {
  it('renders the learner shell with the saved theme', async () => {
    mocks.getActor.mockResolvedValue({ userId: 'learner-1', roles: [] });
    mocks.readWorkspaceTheme.mockResolvedValue('dark');

    render(await LearnerLayout({ children: <p>content</p> }));

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme', 'dark');
  });

  it('passes the learner identity to the shell', async () => {
    mocks.getActor.mockResolvedValue({ userId: 'learner-1', roles: [] });
    mocks.readWorkspaceTheme.mockResolvedValue('system');

    render(await LearnerLayout({ children: <p>content</p> }));

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

    render(await LearnerLayout({ children: <p>content</p> }));

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

    render(await LearnerLayout({ children: <p>content</p> }));

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

    render(await LearnerLayout({ children: <p>learner content</p> }));

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-studio', '/studio');
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-grading', '/grading');
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-admin', '/admin');
    expect(screen.getByText('learner content')).toBeInTheDocument();

    for (const file of pageFiles(join(process.cwd(), 'src/app/app'))) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('AppShell');
    }
  });
});
