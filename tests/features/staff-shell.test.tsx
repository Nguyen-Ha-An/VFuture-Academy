// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { StaffShell } from '@/features/workspace/ui/StaffShell';
import type { WorkspaceEntries } from '@/lib/workspace-navigation';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';

const nav = vi.hoisted(() => ({ pathname: '/studio/courses/course-one', replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => nav, useSearchParams: () => new URLSearchParams() }));
afterEach(cleanup);
const entries: WorkspaceEntries = { studio: '/studio', grading: '/grading', admin: '/admin' };
function view(workspace: 'studio' | 'grading' | 'admin', permissions: Parameters<typeof StaffShell>[0]['permissions'], all: WorkspaceEntries = entries) {
  return render(<NextIntlClientProvider locale="en" messages={en}><StaffShell workspace={workspace} permissions={permissions} entries={all}><StaffPageHeader title="A readable record name" /></StaffShell></NextIntlClientProvider>);
}
describe('shared staff presentation', () => {
  it('keeps the workspace switcher available in the course editor header', () => {
    view('studio', ['course.read']);
    const header = document.querySelector('header')!;
    expect(within(header).getByRole('navigation', { name: en.common.workspaces })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: en.common.workspaceGrading })).toHaveAttribute('href', '/grading');
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
  });
  it('does not expose unrelated destinations to report-only staff', () => {
    nav.pathname = '/grading/reports';
    view('grading', ['report.branch.read'], { studio: null, grading: '/grading', admin: null });
    expect(screen.getByRole('link', { name: en.gradingNav.reports })).toHaveAttribute('href', '/grading/reports');
    expect(screen.queryByRole('link', { name: en.gradingNav.queue })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: en.common.workspaces })).not.toBeInTheDocument();
  });
  it('registers a record title for readable detail breadcrumbs', () => {
    nav.pathname = '/admin/users/00000000-0000-4000-8000-000000000001';
    view('admin', ['member.read']);
    const crumbs = screen.getByRole('navigation', { name: en.common.breadcrumbs });
    expect(within(crumbs).getByText('A readable record name')).toBeInTheDocument();
    expect(crumbs.textContent).not.toContain('00000000');
  });
  it('opens the mobile navigation without losing authorized workspaces', () => {
    nav.pathname = '/grading/queue';
    view('grading', ['submission.grade']);
    fireEvent.click(screen.getByRole('button', { name: en.common.menu }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('link', { name: en.common.workspaceAdmin })).toHaveAttribute('href', '/admin');
  });
});
