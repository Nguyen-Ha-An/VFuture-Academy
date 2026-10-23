import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ComponentProps, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';

import en from '@/messages/en.json';
import vi_ from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

import { ApiError } from '@/lib/api';
import type { Permission } from '@/lib/permissions';

const mocks = vi.hoisted(() => ({
  adminPageContext: vi.fn(),
  adminWorkspacePageContext: vi.fn(),
  adminDashboard: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  forbidden: vi.fn(() => { throw new Error('forbidden:403'); }),
  locale: 'en',
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, forbidden: mocks.forbidden }));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  getLocale: vi.fn(async () => mocks.locale),
}));
vi.mock('@/features/admin/context', () => ({
  adminPageContext: mocks.adminPageContext,
  adminWorkspacePageContext: mocks.adminWorkspacePageContext,
}));
vi.mock('@/features/admin/dashboard', () => ({ adminDashboard: mocks.adminDashboard }));

import AdminPage from '@/app/admin/page';

// The overview renders staff kit components, which read the next-intl client context.
function render(page: ReactNode) {
  const locale = mocks.locale as 'en' | 'vi';
  const messages = staffUiTestMessages(locale === 'vi' ? vi_ : en, locale);
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: 'UTC' } as unknown as ComponentProps<typeof NextIntlClientProvider>, page));
}

function context(permissions: Permission[]) {
  return {
    workspace: 'admin' as const,
    actor: { userId: 'operator', roles: [] },
    scope: { kind: 'central' as const },
    options: [], branches: [], permissions,
    entries: { studio: null, grading: null, admin: '/admin' },
  };
}

describe('Administration entry point', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locale = 'en';
    mocks.adminDashboard.mockResolvedValue({ members: 2, schools: 1, recentActivity: [] });
  });

  it('sends a course.publish publisher to enrollment-version migration instead of a dead end', async () => {
    mocks.adminWorkspacePageContext.mockResolvedValue(context(['course.publish']));

    await expect(AdminPage()).rejects.toThrow('redirect:/admin/enrollment-migration');
    expect(mocks.adminPageContext).not.toHaveBeenCalled();
    expect(mocks.adminDashboard).not.toHaveBeenCalled();
  });

  it('keeps the overview behind admin.access', async () => {
    mocks.adminWorkspacePageContext.mockResolvedValue(context(['admin.access', 'member.read']));
    mocks.adminPageContext.mockResolvedValue(context(['admin.access', 'member.read']));

    await AdminPage();

    expect(mocks.adminPageContext).toHaveBeenCalled();
    expect(mocks.adminDashboard).toHaveBeenCalled();
  });

  it('still refuses the overview when the strict context denies it', async () => {
    mocks.adminWorkspacePageContext.mockResolvedValue(context(['admin.access']));
    mocks.adminPageContext.mockImplementation(async () => {
      mocks.forbidden();
      throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    });

    await expect(AdminPage()).rejects.toThrow('forbidden:403');
    expect(mocks.adminDashboard).not.toHaveBeenCalled();
  });

  it('does not loop when a narrow operator has no other administrative destination', async () => {
    mocks.adminWorkspacePageContext.mockResolvedValue(context([]));
    mocks.adminPageContext.mockImplementation(async () => {
      mocks.forbidden();
      throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    });

    await expect(AdminPage()).rejects.toThrow('forbidden:403');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('renders KPIs in a description list and offers "Invite member" only with membership.manage', async () => {
    mocks.adminWorkspacePageContext.mockResolvedValue(context(['admin.access', 'member.read', 'membership.manage']));
    mocks.adminPageContext.mockResolvedValue(context(['admin.access', 'member.read', 'membership.manage']));

    const html = render(await AdminPage());

    expect(html).toMatch(/<dt[^>]*>.*Members.*<\/dt><dd[^>]*><span[^>]*>2<\/span>/);
    expect(html).toContain('href="/admin/users?invite=1"');
    expect(html).toContain('Invite member');

    mocks.adminWorkspacePageContext.mockResolvedValue(context(['admin.access', 'member.read']));
    mocks.adminPageContext.mockResolvedValue(context(['admin.access', 'member.read']));
    expect(render(await AdminPage())).not.toContain('invite=1');
  });

  it('renders readable labels in recent activity', async () => {
    mocks.adminWorkspacePageContext.mockResolvedValue(context(['admin.access']));
    mocks.adminPageContext.mockResolvedValue(context(['admin.access']));
    mocks.adminDashboard.mockResolvedValue({
      members: 2,
      schools: 1,
      recentActivity: [{
        id: 'audit-1',
        action: 'invitation.revoke',
        actorId: 'operator',
        targetType: 'invitation',
        targetId: 'invite-1',
        at: '2026-09-06T00:00:00.000Z',
      }],
    });

    const html = render(await AdminPage());

    expect(html).toContain('Invitation revoked');
    expect(html).not.toContain('invitation.revoke');
  });

  it('passes the server locale to recent activity formatting', async () => {
    mocks.locale = 'vi';
    mocks.adminWorkspacePageContext.mockResolvedValue(context(['admin.access']));
    mocks.adminPageContext.mockResolvedValue(context(['admin.access']));
    mocks.adminDashboard.mockResolvedValue({
      members: 2,
      schools: 1,
      recentActivity: [{
        id: 'audit-1',
        action: 'invitation.revoke',
        actorId: 'operator',
        targetType: 'invitation',
        targetId: 'invite-1',
        at: '2026-09-06T00:00:00.000Z',
      }],
    });

    const html = render(await AdminPage());

    // Vietnamese verb in lower case after the actor, without the repeated type word.
    expect(html).toContain('đã thu hồi lời mời');
    expect(html).not.toContain('lời mời Lời mời');
  });
});
