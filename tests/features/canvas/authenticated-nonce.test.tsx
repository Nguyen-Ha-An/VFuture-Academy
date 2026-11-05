// @vitest-environment node
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ nonce: 'request-one' as string | undefined }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers(fixture.nonce ? { 'x-nonce': fixture.nonce } : {}) }));
vi.mock('@/lib/permissions', () => ({ getActor: async () => ({ userId: 'nonce-fixture', roles: [] }) }));
vi.mock('@/lib/auth', () => ({ loginDestination: async () => '/login' }));
vi.mock('@/lib/workspace-admission', () => ({ workspaceEntries: () => ({ studio: null, grading: null, admin: null }) }));
vi.mock('@/features/workspace-ui/theme.server', () => ({ readWorkspaceTheme: async () => 'light' }));
vi.mock('@/features/workspace-ui/identity.server', () => ({ learnerIdentity: async () => ({ name: 'Synthetic fixture', initials: 'SF' }) }));
vi.mock('@/features/staff-ui/chrome.server', () => ({ readStaffChrome: async () => ({ theme: 'light', sidebarOpen: true, identity: { name: 'Synthetic fixture', initials: 'SF' } }) }));
vi.mock('@/features/staff-ui/fonts', () => ({ preloadStaffFonts() {} }));
vi.mock('@/features/workspace/context', () => ({
  studioPageContext: async () => ({ actor: { userId: 'nonce-fixture' }, scope: { kind: 'central' }, permissions: [], options: [], entries: {} }),
  gradingPageContext: async () => ({ actor: { userId: 'nonce-fixture' }, scope: { kind: 'central' }, permissions: [], options: [], entries: {} }),
}));
vi.mock('@/features/admin/context', () => ({ adminWorkspacePageContext: async () => ({ actor: { userId: 'nonce-fixture' }, scope: { kind: 'central' }, permissions: [], options: [], entries: {} }) }));
vi.mock('@/features/admin/components/AdminSessionGuard', () => ({ AdminSessionGuard: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/AppShell', () => ({ AppShell: ({ nonce, children }: { nonce?: string; children: ReactNode }) => <div data-nonce={nonce}>{children}</div> }));
vi.mock('@/features/staff-ui/ui/StaffWorkspaceShell', () => ({ StaffWorkspaceShell: ({ nonce, children }: { nonce?: string; children: ReactNode }) => <div data-nonce={nonce}>{children}</div> }));
vi.mock('@/components/StudioShell', () => ({ StudioShell: () => null }));
vi.mock('@/components/AdminShell', () => ({ AdminShell: () => null }));
vi.mock('@/components/GradingShell', () => ({ GradingShell: () => null }));

import LearnerLayout from '@/app/app/layout';
import StudioLayout from '@/app/studio/layout';
import GradingLayout from '@/app/grading/layout';
import AdminLayout from '@/app/admin/layout';

it.each([['learner', LearnerLayout], ['studio', StudioLayout], ['grading', GradingLayout], ['admin', AdminLayout]] as const)('%s passes the current request nonce to its owning client shell without caching another request', async (name, Layout) => {
  fixture.nonce = `${name}-request-a`;
  const first = renderToStaticMarkup(await Layout({ children: <p>Protected content</p> }));
  fixture.nonce = `${name}-request-b`;
  const second = renderToStaticMarkup(await Layout({ children: <p>Protected content</p> }));
  expect(first).toContain(`data-nonce="${name}-request-a"`);
  expect(second).toContain(`data-nonce="${name}-request-b"`);
  expect(second).not.toContain(`${name}-request-a`);
  fixture.nonce = undefined;
  expect(renderToStaticMarkup(await Layout({ children: <p>Protected content</p> }))).not.toContain('data-nonce=');
});
