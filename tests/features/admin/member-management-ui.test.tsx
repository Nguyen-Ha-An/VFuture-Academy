// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MembersDirectory } from '@/features/admin/components/MembersDirectory';
import { MemberProfile } from '@/features/admin/components/MemberProfile';
import { RoleManager } from '@/features/admin/components/RoleManager';

import productionMessages from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const navigation = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

const messages = {
  memberAdmin: {
    ...productionMessages.memberAdmin,
    title: 'Members', search: 'Search', allStatuses: 'All statuses', allRoles: 'All roles', allKinds: 'All people', kind: 'Type', learner: 'Learner', staff: 'Staff',
    name: 'Name', email: 'Email', school: 'School', roles: 'Roles', status: 'Status', details: 'Details',
    active: 'Active', suspended: 'Suspended', previous: 'Previous', next: 'Next', page: 'Page {page}', loading: 'Loading…',
    empty: 'No matching members.', retry: 'Retry', invitations: 'Invitations', inviteMember: 'Invite member',
    inviteEmail: 'Email address', inviteSchool: 'School', inviteRole: 'Initial role', noRole: 'No role', sendInvite: 'Create invite',
    expires: 'Expires {date}', copyLink: 'Copy invite link', revoke: 'Revoke', reissue: 'Reissue', inviteCreated: 'Invite created. Copy the one-time link now.',
    information: 'Information', schoolsRoles: 'Schools & roles', learning: 'Learning', submissionsResults: 'Submissions & results', memberDetails: 'Member details', createdAt: 'Created', role: 'Role',
    managementHistory: 'Management history', displayName: 'Display name', save: 'Save', transfer: 'Transfer school',
    accountStatus: 'Account status', membershipStatus: 'Membership status', effectivePermissions: 'Effective permissions',
    confirm: 'Confirm', cancel: 'Cancel', confirmChange: 'Confirm change', rolesPermissions: 'Roles & permissions',
    roleDefinitions: 'Role definitions', createRole: 'Create role', roleName: 'Role name', description: 'Description',
    scopeKind: 'Scope', central: 'Central', branch: 'School', permissions: 'Permissions', grantableBySchool: 'School grantable',
    assignmentCount: '{count} assignments', edit: 'Edit', updateRole: 'Update role', builtIn: 'Built-in', readOnly: 'Read only', noSchool: 'No school assigned', error: 'Something went wrong. Try again.',
    submissionsUnavailable: 'Submission details are not available.', historyUnavailable: 'Management history is not available.',
  },
};

const scope = { kind: 'branch' as const, branchId: 'ans' };
const options = {
  scope,
  branches: [{ id: 'ans', name: 'ANS' }],
  roles: [{ id: 'school-admin', name: 'School admin', description: 'Manage a school', scopeKind: 'branch' as const, permissions: ['member.read'], builtIn: true, grantableBySchool: true, version: 1, assignmentCount: 2 }],
  permissions: ['member.read', 'member.manage', 'membership.manage', 'role.definition.manage', 'role.definition.read'] as const,
};
const member = {
  id: 'member-1', displayName: 'Mai Nguyen', handle: 'mai', email: 'mai@example.com', branchId: 'ans',
  accountStatus: 'active' as const, createdAt: '2026-09-01T00:00:00.000Z', memberships: [{ branchId: 'ans', branchName: 'ANS', status: 'active' as const, isPrimary: true }],
  assignments: [{ id: 'assignment-1', roleId: 'school-admin', roleName: 'School admin', scope, grantedAt: '2026-09-01T00:00:00.000Z', grantedBy: 'admin-1' }],
};

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={staffUiTestMessages(messages, 'en')}>{children}</NextIntlClientProvider>;
}

function data(value: unknown, status = 200) {
  return new Response(JSON.stringify({ data: value }), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  cleanup();
  navigation.search = '';
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MembersDirectory', () => {
  it('loads scoped members immediately and creates a copyable one-time invitation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations') && init?.method === 'POST') return data({ id: 'invite-1', email: 'new@example.com', branchId: 'ans', roleId: 'school-admin', expiresAt: '2026-09-13T00:00:00.000Z', status: 'pending', createdAt: '2026-09-06T00:00:00.000Z', inviteUrl: 'https://example.test/invite/token' }, 201);
      if (url.includes('/invitations')) return data([]);
      return data({ items: [member], page: 1, pageSize: 20, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<Provider><MembersDirectory scope={scope} /></Provider>);
    expect(await screen.findByRole('link', { name: 'Mai Nguyen' })).toHaveAttribute('href', '/admin/users/member-1');
    await waitFor(() => expect(String(fetchMock.mock.calls[0]?.[0])).toContain('scope=branch%3Aans'));

    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText('Email address'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByRole('button', { name: 'Copy invite link' })).toBeInTheDocument();
  });

  it('keeps invitation input after a failed creation request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations') && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: { message: 'request_failed' } }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/invitations')) return data([]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    }));
    const user = userEvent.setup();
    render(<Provider><MembersDirectory scope={scope} /></Provider>);

    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    const email = await screen.findByLabelText('Email address');
    await user.type(email, 'retry@example.com');
    await user.click(screen.getByRole('button', { name: 'Create invite' }));

    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(email).toHaveValue('retry@example.com');
  });

  it('updates the committed controls and member request after browser history changes without reloading supporting data', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations')) return data([]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<Provider><MembersDirectory scope={scope} /></Provider>);
    await screen.findByRole('status');

    navigation.search = 'memberQuery=returning&memberStatus=suspended&memberPage=2';
    view.rerender(<Provider><MembersDirectory scope={scope} /></Provider>);

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes('query=returning') && String(url).includes('status=suspended') && String(url).includes('page=2'),
    )).toBe(true));
    expect(screen.getByLabelText('Search')).toHaveValue('returning');
    expect(screen.getByLabelText('Status')).toHaveValue('suspended');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/options'))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/users?') && String(url).includes('query=returning'))).toHaveLength(1);
  });

  it('restarts an aborted member request during StrictMode effect replay', async () => {
    const pending = new Promise<Response>(() => undefined);
    let memberRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations')) return data([]);
      memberRequests += 1;
      if (memberRequests === 1) return pending;
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <StrictMode>
        <Provider><MembersDirectory scope={scope} /></Provider>
      </StrictMode>,
    );

    await waitFor(() => expect(memberRequests).toBe(2));
    expect(await screen.findAllByText('No matching members.')).toHaveLength(2);
  });

  it('reloads members when the administrative scope or actor changes with the same URL filters', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations')) return data([]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<Provider><MembersDirectory scope={scope} actorId="actor-1" /></Provider>);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('scope=branch%3Aans'))).toBe(true));

    view.rerender(<Provider><MembersDirectory scope={{ kind: 'central' }} actorId="actor-1" /></Provider>);

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('scope=central'))).toBe(true));

    view.rerender(<Provider><MembersDirectory scope={{ kind: 'central' }} actorId="actor-2" /></Provider>);

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/users?') && String(url).includes('actorId=actor-2'))).toBe(true));
  });

  it('sends one invitation request while creation is pending', async () => {
    let resolveInvite!: (response: Response) => void;
    const invite = new Promise<Response>((resolve) => { resolveInvite = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations') && init?.method === 'POST') return invite;
      if (url.includes('/invitations')) return data([]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><MembersDirectory scope={scope} /></Provider>);

    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    await user.type(await screen.findByLabelText('Email address'), 'new@example.com');
    const form = screen.getByRole('button', { name: 'Create invite' }).closest('form');
    expect(form).not.toBeNull();
    await act(async () => {
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/invitations') && init?.method === 'POST')).toHaveLength(1);
    resolveInvite(data({ id: 'invite-1', email: 'new@example.com', branchId: 'ans', roleId: null, expiresAt: '2026-09-13T00:00:00.000Z', status: 'pending', createdAt: '2026-09-06T00:00:00.000Z', inviteUrl: 'https://example.test/invite/token' }, 201));
    expect(await screen.findByRole('button', { name: 'Copy invite link' })).toBeInTheDocument();
  });

  it('aborts member and supporting requests when unmounted', async () => {
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations')) return data([]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    }));
    const view = render(<Provider><MembersDirectory scope={scope} /></Provider>);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    view.unmount();
    expect(abort).toHaveBeenCalledTimes(2);
  });

  it('revokes an existing invitation before reissuing a fresh one', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations/invite-1/revoke')) return data({ revoked: true });
      if (url.includes('/invitations') && init?.method === 'POST') return data({ id: 'invite-2', email: 'new@example.com', branchId: 'ans', roleId: 'school-admin', expiresAt: '2026-09-13T00:00:00.000Z', status: 'pending', createdAt: '2026-09-06T00:00:00.000Z', inviteUrl: 'https://example.test/invite/fresh' }, 201);
      if (url.includes('/invitations')) return data([{ id: 'invite-1', email: 'new@example.com', branchId: 'ans', roleId: 'school-admin', expiresAt: '2026-09-12T00:00:00.000Z', status: 'pending', createdAt: '2026-09-06T00:00:00.000Z' }]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    }));
    const user = userEvent.setup();
    render(<Provider><MembersDirectory scope={scope} /></Provider>);
    await user.click(await screen.findByRole('button', { name: 'Reissue' }));
    await waitFor(() => expect(calls.findIndex((call) => call.startsWith('POST ') && call.includes('/revoke'))).toBeGreaterThan(-1));
    expect(calls.findIndex((call) => call.startsWith('POST ') && call.includes('/revoke'))).toBeLessThan(calls.findIndex((call) => call.startsWith('POST ') && call.endsWith('/invitations?scope=branch%3Aans')));
  });

  it('sends one revoke request for same-tick repeated invitation actions', async () => {
    let resolveRevoke!: (response: Response) => void;
    const revoke = new Promise<Response>((resolve) => { resolveRevoke = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations/invite-1/revoke') && init?.method === 'POST') return revoke;
      if (url.includes('/invitations')) return data([{ id: 'invite-1', email: 'new@example.com', branchId: 'ans', roleId: null, expiresAt: '2026-09-12T00:00:00.000Z', status: 'pending', createdAt: '2026-09-06T00:00:00.000Z' }]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Provider><MembersDirectory scope={scope} /></Provider>);

    const revokeButton = await screen.findByRole('button', { name: 'Revoke' });
    await act(async () => {
      revokeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      revokeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/revoke') && init?.method === 'POST')).toHaveLength(1);
    resolveRevoke(data({ revoked: true }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument());
  });

  it('sends one revoke request for same-tick repeated reissues', async () => {
    let resolveRevoke!: (response: Response) => void;
    const revoke = new Promise<Response>((resolve) => { resolveRevoke = resolve; });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations/invite-1/revoke') && init?.method === 'POST') return revoke;
      if (url.includes('/invitations') && init?.method === 'POST') return data({ id: 'invite-2', email: 'new@example.com', branchId: 'ans', roleId: null, expiresAt: '2026-09-13T00:00:00.000Z', status: 'pending', createdAt: '2026-09-06T00:00:00.000Z', inviteUrl: 'https://example.test/invite/fresh' }, 201);
      if (url.includes('/invitations')) return data([{ id: 'invite-1', email: 'new@example.com', branchId: 'ans', roleId: null, expiresAt: '2026-09-12T00:00:00.000Z', status: 'pending', createdAt: '2026-09-06T00:00:00.000Z' }]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Provider><MembersDirectory scope={scope} /></Provider>);

    const reissueButton = await screen.findByRole('button', { name: 'Reissue' });
    await act(async () => {
      reissueButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      reissueButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/revoke') && init?.method === 'POST')).toHaveLength(1);
    resolveRevoke(data({ revoked: true }));
    expect(await screen.findByRole('button', { name: 'Copy invite link' })).toBeInTheDocument();
  });

  it('shows invitation controls to a membership manager without member identity management', async () => {
    const membershipOptions = { ...options, permissions: ['member.read', 'membership.manage'] as const };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/options')) return data(membershipOptions);
      if (String(input).includes('/invitations')) return data([]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    }));
    const user = userEvent.setup();
    render(<Provider><MembersDirectory scope={scope} /></Provider>);
    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    expect(await screen.findByLabelText('Email address')).toBeInTheDocument();
  });
});

describe('MembersDirectory (staff refresh)', () => {
  function supportingFetch(permissions: readonly string[] = options.permissions, invitations: unknown[] = []) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/options')) return data({ ...options, permissions });
      if (url.includes('/invitations')) return data(invitations);
      return data({ items: [member], page: 1, pageSize: 20, hasMore: false });
    });
  }

  it('opens the invite sheet once from ?invite=1 and drops the parameter when it closes', async () => {
    navigation.search = 'invite=1&memberQuery=mai';
    window.history.replaceState(null, '', '/admin/users?invite=1&memberQuery=mai');
    vi.stubGlobal('fetch', supportingFetch());
    const user = userEvent.setup();
    render(<Provider><MembersDirectory scope={scope} /></Provider>);

    const sheet = await screen.findByRole('dialog', { name: 'Invite member' });
    expect(within(sheet).getByLabelText('Email address')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Create invite' })).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.search).not.toContain('invite=1');
    expect(window.location.search).toContain('memberQuery=mai');
    expect(screen.getByRole('link', { name: 'Mai Nguyen' }).getAttribute('href')).not.toContain('invite');
  });

  it('never opens the invite sheet, action or invitations card without invitation permission', async () => {
    navigation.search = 'invite=1';
    const fetchMock = supportingFetch(['member.read']);
    vi.stubGlobal('fetch', fetchMock);
    render(<Provider><MembersDirectory scope={scope} /></Provider>);

    expect(await screen.findByRole('link', { name: 'Mai Nguyen' })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/options'))).toBe(true));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invitations' })).not.toBeInTheDocument();
  });

  it('keeps the one-time link and copy action inside the sheet and forgets it on close', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations') && init?.method === 'POST') return data({ id: 'invite-1', email: 'new@example.com', branchId: 'ans', roleId: null, expiresAt: '2026-09-13T00:00:00.000Z', status: 'pending', createdAt: '2026-09-06T00:00:00.000Z', inviteUrl: 'https://example.test/invite/token' }, 201);
      if (url.includes('/invitations')) return data([]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    }));
    const user = userEvent.setup();
    // user-event installs its own clipboard stub; spy on it after setup.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render(<Provider><MembersDirectory scope={scope} /></Provider>);

    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    const sheet = screen.getByRole('dialog', { name: 'Invite member' });
    await user.type(within(sheet).getByLabelText('Email address'), 'new@example.com');
    await user.click(within(sheet).getByRole('button', { name: 'Create invite' }));
    await user.click(await within(sheet).findByRole('button', { name: 'Copy invite link' }));
    expect(writeText).toHaveBeenCalledWith('https://example.test/invite/token');
    expect(within(sheet).getByRole('link', { name: 'https://example.test/invite/token' })).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const invitations = screen.getByRole('region', { name: 'Invitations' });
    expect(within(invitations).getByText('new@example.com')).toBeInTheDocument();
    expect(within(invitations).getByText('Pending')).toHaveAttribute('data-tone', 'warning');
    expect(screen.queryByText('https://example.test/invite/token')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Copy invite link' })).not.toBeInTheDocument();
  });

  it('keeps the pending invitations KPI in step with invites created and revoked on the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations/invite-1/revoke')) return data({ revoked: true });
      if (url.includes('/invitations') && init?.method === 'POST') return data({ id: 'invite-1', email: 'new@example.com', branchId: 'ans', roleId: null, expiresAt: '2026-09-13T00:00:00.000Z', status: 'pending', createdAt: '2026-09-06T00:00:00.000Z', inviteUrl: 'https://example.test/invite/token' }, 201);
      if (url.includes('/invitations')) return data([]);
      return data({ items: [], page: 1, pageSize: 20, hasMore: false });
    }));
    const user = userEvent.setup();
    render(<Provider><MembersDirectory scope={scope} stats={{ pendingInvitations: 2 }} /></Provider>);
    const kpi = () => screen.getByText('Pending invitations').closest('[data-slot="stat-card"]') as HTMLElement;
    expect(within(kpi()).getByText('2')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Invite member' }));
    const sheet = screen.getByRole('dialog', { name: 'Invite member' });
    await user.type(within(sheet).getByLabelText('Email address'), 'new@example.com');
    await user.click(within(sheet).getByRole('button', { name: 'Create invite' }));
    await within(sheet).findByRole('button', { name: 'Copy invite link' });
    expect(within(kpi()).getByText('3')).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(within(screen.getByRole('region', { name: 'Invitations' })).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(within(kpi()).getByText('2')).toBeInTheDocument());
  });

  it('shows member rows with a status badge and a row menu, and pages without a total', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/options')) return data(options);
      if (url.includes('/invitations')) return data([]);
      return data({ items: [{ ...member, accountStatus: 'suspended' }], page: 1, pageSize: 20, hasMore: true });
    }));
    render(<Provider><MembersDirectory scope={scope} /></Provider>);

    const table = await screen.findByRole('table', { name: 'Members' });
    const row = within(table).getByRole('link', { name: 'Mai Nguyen' }).closest('tr')!;
    expect(within(row).getByText('mai@example.com')).toBeInTheDocument();
    expect(within(row).getByText('Suspended')).toHaveAttribute('data-tone', 'danger');
    expect(within(row).getByRole('button', { name: 'Actions for Mai Nguyen' })).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.queryByText(/of \d+/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('renders only the KPI cards it was given: hidden when absent, Unavailable when null, never a delta', async () => {
    vi.stubGlobal('fetch', supportingFetch());
    render(<Provider><MembersDirectory scope={scope} stats={{ members: 1200, learners: null, suspended: 4 }} /></Provider>);

    await screen.findByRole('link', { name: 'Mai Nguyen' });
    const kpis = document.querySelector('[data-slot="stat-grid"]') as HTMLElement;
    expect(kpis).toHaveAttribute('aria-label', 'Member summary');
    expect(within(kpis).getByText('Members').closest('[data-slot="stat-card"]')).toHaveTextContent('1,200');
    expect(within(kpis).getByText('Learners').closest('[data-slot="stat-card"]')).toHaveTextContent('Unavailable');
    expect(within(kpis).getByRole('link', { name: 'Suspended' })).toHaveAttribute('href', '/admin/users?memberStatus=suspended');
    expect(within(kpis).queryByRole('link', { name: 'Learners' })).not.toBeInTheDocument();
    expect(within(kpis).queryByText('Pending invitations')).not.toBeInTheDocument();
    expect(kpis.querySelector('[data-slot="stat-delta"]')).toBeNull();
  });

  it('renders no KPI row when the page passes no stats (harness)', async () => {
    vi.stubGlobal('fetch', supportingFetch());
    render(<Provider><MembersDirectory scope={scope} /></Provider>);
    await screen.findByRole('link', { name: 'Mai Nguyen' });
    expect(document.querySelector('[data-slot="stat-grid"]')).toBeNull();
  });
});

describe('MemberProfile', () => {
  it('links Central managers from a member profile to that member’s MCP block control', async () => {
    const centralScope = { kind: 'central' as const };
    const detail = { ...member, effectivePermissions: [], actions: { editIdentity: false, transfer: false, suspendAccount: false, manageMembership: false, assignRole: false, readLearning: false, readSubmissions: false, readHistory: false } };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/options') ? data({ ...options, scope: centralScope }) : data(detail)));

    render(<Provider><MemberProfile userId="00000000-0000-4000-8000-000000000123" scope={centralScope} canManageMcpAccess /></Provider>);

    expect(await screen.findByRole('link', { name: 'Manage MCP access' }))
      .toHaveAttribute('href', '/admin/mcp?userId=00000000-0000-4000-8000-000000000123');
  });

  it('requires confirmation before suspending an account and refetches the detail', async () => {
    const detail = { ...member, effectivePermissions: [{ scope, permissions: ['member.read'] }], actions: { editIdentity: true, transfer: true, suspendAccount: true, manageMembership: true, assignRole: true, readLearning: true, readSubmissions: true, readHistory: true } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/options')) return data(options);
      if (init?.method === 'PATCH') return data({ ...detail, accountStatus: 'suspended' });
      return data(detail);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><MemberProfile userId="member-1" scope={scope} /></Provider>);
    expect(await screen.findByRole('heading', { name: 'Mai Nguyen' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Suspend account' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true));
  });

  it('confirms a scoped role revocation before sending the disabled role action', async () => {
    const detail = { ...member, effectivePermissions: [{ scope, permissions: ['member.read'] }], actions: { editIdentity: true, transfer: true, suspendAccount: true, manageMembership: true, assignRole: true, readLearning: true, readSubmissions: true, readHistory: true } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/options')) return data(options);
      if (init?.method === 'PATCH') return data(detail);
      return data(detail);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><MemberProfile userId="member-1" scope={scope} /></Provider>);
    await user.click(await screen.findByRole('tab', { name: 'Schools & roles' }));
    await user.click(screen.getByRole('button', { name: 'Revoke School admin' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH' && JSON.parse(String(init.body)).enabled === false)).toBe(true));
  });

  it('uses the returned primary school rather than the viewer central scope', async () => {
    const centralScope = { kind: 'central' as const };
    const centralOptions = { ...options, scope: centralScope };
    const detail = { ...member, effectivePermissions: [], actions: { editIdentity: false, transfer: false, suspendAccount: false, manageMembership: false, assignRole: false, readLearning: false, readSubmissions: false, readHistory: false } };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/options') ? data(centralOptions) : data(detail)));
    render(<Provider><MemberProfile userId="member-1" scope={centralScope} /></Provider>);
    expect(await screen.findByText('ANS')).toBeInTheDocument();
    expect(screen.queryByText('Central')).not.toBeInTheDocument();
  });

  it('locks a central role assignment to central scope', async () => {
    const mixedOptions = { ...options, roles: [...options.roles, { id: 'central-reviewer', name: 'Central reviewer', description: 'Review', scopeKind: 'central' as const, permissions: ['member.read'], builtIn: true, grantableBySchool: false, version: 1, assignmentCount: 1 }] };
    const detail = { ...member, effectivePermissions: [], actions: { editIdentity: false, transfer: false, suspendAccount: false, manageMembership: false, assignRole: true, readLearning: false, readSubmissions: false, readHistory: false } };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/options') ? data(mixedOptions) : data(detail)));
    const user = userEvent.setup();
    render(<Provider><MemberProfile userId="member-1" scope={scope} /></Provider>);
    await user.click(await screen.findByRole('tab', { name: 'Schools & roles' }));
    await user.selectOptions(screen.getByLabelText('Role'), 'central-reviewer');
    expect(screen.getByLabelText('School')).toHaveValue('');
    expect(screen.getByLabelText('School')).toBeDisabled();
  });
});

describe('MemberProfile (staff refresh)', () => {
  const allActions = { editIdentity: true, transfer: true, suspendAccount: true, manageMembership: true, assignRole: true, readLearning: true, readSubmissions: true, readHistory: true };
  const actorId = '11111111-2222-4333-8444-555555555555';

  function profileFetch(detail: unknown, profileOptions: unknown = options) {
    return vi.fn(async (input: RequestInfo | URL) => String(input).includes('/options') ? data(profileOptions) : data(detail));
  }

  it('uses course and item titles in the learning and results tables, with readable historical fallbacks', async () => {
    const detail = {
      ...member,
      effectivePermissions: [],
      actions: allActions,
      learning: [
        { courseId: 'python-basics', courseVersionId: 'v1', title: 'python-basics', displayTitle: 'Python Basics', status: 'active', completedLessons: 2, totalLessons: 5, branchId: 'ans' },
        { courseId: 'old-course', courseVersionId: 'v0', title: 'old-course', status: 'active', completedLessons: 1, totalLessons: 4, branchId: 'ans' },
      ],
      submissions: [
        { id: 's1', courseVersionId: 'v1', itemId: 'essay-one', displayTitle: 'First essay', status: 'submitted', submittedAt: '2026-09-02T00:00:00.000Z', branchId: 'ans', percent: null },
        { id: 's2', courseVersionId: 'v0', itemId: 'old-item', status: 'submitted', submittedAt: '2026-09-02T00:00:00.000Z', branchId: 'ans', percent: null },
      ],
      examResults: [{ id: 'e1', courseVersionId: 'v1', itemId: 'final-exam', displayTitle: 'Final exam', status: 'submitted', submittedAt: '2026-09-02T00:00:00.000Z', branchId: 'ans', percent: 90 }],
    };
    vi.stubGlobal('fetch', profileFetch(detail));
    const user = userEvent.setup();
    render(<Provider><MemberProfile userId="member-1" scope={scope} /></Provider>);

    await user.click(await screen.findByRole('tab', { name: 'Learning' }));
    expect(screen.getByText('Python Basics')).toBeInTheDocument();
    expect(screen.getByText('Course title unavailable')).toBeInTheDocument();
    expect(screen.queryByText('python-basics')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Submissions & results' }));
    expect(screen.getByText('First essay')).toBeInTheDocument();
    expect(screen.getByText('Final exam')).toBeInTheDocument();
    expect(screen.getByText('Item title unavailable')).toBeInTheDocument();
    expect(screen.queryByText('essay-one')).not.toBeInTheDocument();
  });

  it('shows a header card with the status and a visible account action, plus stats from the detail read', async () => {
    const submissions = Array.from({ length: 100 }, (_, index) => ({ id: `s-${index}`, courseVersionId: 'v1', itemId: `item-${index}`, status: 'submitted', submittedAt: '2026-09-02T00:00:00.000Z', branchId: 'ans', percent: null }));
    const detail = { ...member, effectivePermissions: [], actions: allActions, learning: [{ courseId: 'python', courseVersionId: 'v1', title: 'Python basics', status: 'active', completedLessons: 2, totalLessons: 5, branchId: 'ans' }], submissions };
    vi.stubGlobal('fetch', profileFetch(detail));
    render(<Provider><MemberProfile userId="member-1" scope={scope} /></Provider>);

    expect(await screen.findByRole('heading', { level: 1, name: 'Mai Nguyen' })).toBeInTheDocument();
    expect(screen.getByText('mai@example.com · @mai')).toBeInTheDocument();
    expect(screen.getByText('Active')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByRole('button', { name: 'Suspend account' })).toBeVisible();

    const stats = document.querySelector('[data-slot="stat-grid"]') as HTMLElement;
    const card = (label: string) => within(stats).getByText(label).closest('[data-slot="stat-card"]');
    expect(card('Schools')).toHaveTextContent('1');
    expect(card('Roles')).toHaveTextContent('1');
    expect(card('Courses')).toHaveTextContent('1');
    // The read returns the latest 100 submissions, so a full page is a floor, not a total.
    expect(card('Submissions')).toHaveTextContent('100+');
    expect(stats.querySelector('[data-slot="stat-delta"]')).toBeNull();
  });

  it('hides stat cards for lists the viewer may not read', async () => {
    const detail = { ...member, effectivePermissions: [], actions: { ...allActions, readLearning: false, readSubmissions: false }, learning: [], submissions: [] };
    vi.stubGlobal('fetch', profileFetch(detail));
    render(<Provider><MemberProfile userId="member-1" scope={scope} /></Provider>);
    await screen.findByRole('heading', { level: 1, name: 'Mai Nguyen' });
    const stats = document.querySelector('[data-slot="stat-grid"]') as HTMLElement;
    expect(within(stats).queryByText('Courses')).not.toBeInTheDocument();
    expect(within(stats).queryByText('Submissions')).not.toBeInTheDocument();
  });

  it('shows management history with readable labels and actor names from the actors map', async () => {
    const detail = {
      ...member,
      assignments: [{ ...member.assignments[0], grantedBy: actorId }],
      effectivePermissions: [],
      actions: allActions,
      history: [
        { id: 'h1', action: 'user.account-status', actorId: actorId.toUpperCase(), targetType: 'user', targetId: 'member-1', at: '2026-09-03T08:00:00.000Z' },
        { id: 'h2', action: 'user.role_granted', actorId: null, targetType: 'user', targetId: 'member-1', at: '2026-09-02T08:00:00.000Z' },
      ],
      actors: { [actorId]: { name: 'Trần Thu Hà', initials: 'TH', avatarUrl: null } },
    };
    vi.stubGlobal('fetch', profileFetch(detail));
    const user = userEvent.setup();
    render(<Provider><MemberProfile userId="member-1" scope={scope} /></Provider>);

    await user.click(await screen.findByRole('tab', { name: 'Management history' }));
    const timeline = document.querySelector('[data-slot="timeline-card"]') as HTMLElement;
    expect(within(timeline).getByText('Account status changed')).toBeInTheDocument();
    expect(within(timeline).getByText('Role granted')).toBeInTheDocument();
    expect(within(timeline).getAllByText('Member')).toHaveLength(2);
    expect(timeline).toHaveTextContent('by Trần Thu Hà');
    expect(timeline).toHaveTextContent('by System');
    expect(timeline).not.toHaveTextContent('user.account-status');

    await user.click(screen.getByRole('tab', { name: 'Schools & roles' }));
    expect(screen.getByText(/Trần Thu Hà/)).toBeInTheDocument();
  });

  it('links each submission to the canonical grading assignment route for graders', async () => {
    const detail = { ...member, effectivePermissions: [], actions: allActions, submissions: [{ id: 'sub 1', courseVersionId: 'v1', itemId: 'essay', status: 'in_review', submittedAt: '2026-09-02T00:00:00.000Z', branchId: 'ans', percent: 80 }] };
    vi.stubGlobal('fetch', profileFetch(detail, { ...options, permissions: [...options.permissions, 'submission.grade'] }));
    const user = userEvent.setup();
    render(<Provider><MemberProfile userId="member-1" scope={scope} /></Provider>);

    await user.click(await screen.findByRole('tab', { name: 'Submissions & results' }));
    expect(screen.getByRole('link', { name: 'Open in grading' })).toHaveAttribute('href', '/grading/assignments/sub%201');
    expect(screen.getByText('In review')).toHaveAttribute('data-tone');
    expect(screen.getByText('80%')).toBeInTheDocument();
  });
});

describe('RoleManager', () => {
  it('shows the role definition editor only with the definition-management permission and posts a confirmed role', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/options')) return data(options);
      if (init?.method === 'POST') return data({ ...options.roles[0], id: 'custom-role', name: 'Mentor', builtIn: false, assignmentCount: 0 }, 201);
      return data(options.roles);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><RoleManager scope={scope} /></Provider>);
    expect(await screen.findByRole('heading', { name: 'Roles & permissions' })).toBeInTheDocument();
    // The editor lives in a Sheet behind "New role"; the confirm step sits in the sheet footer.
    await user.click(await screen.findByRole('button', { name: 'New role' }));
    const sheet = screen.getByRole('dialog', { name: 'Create role' });
    await user.type(within(sheet).getByLabelText('Role name'), 'Mentor');
    await user.click(within(sheet).getByRole('button', { name: 'Create role' }));
    const confirm = within(sheet).getByRole('region', { name: 'Confirm change' });
    expect(confirm).toHaveTextContent('Mentor');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
  });

  it('names the selected role scope and assignment impact in the confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/options') ? data(options) : data(options.roles)));
    const user = userEvent.setup();
    render(<Provider><RoleManager scope={scope} /></Provider>);
    await screen.findByRole('heading', { name: 'Roles & permissions' });
    await user.click(await screen.findByRole('button', { name: 'New role' }));
    const sheet = screen.getByRole('dialog', { name: 'Create role' });
    await user.type(within(sheet).getByLabelText('Role name'), 'Mentor');
    await user.selectOptions(within(sheet).getByLabelText('Scope'), 'central');
    await user.click(within(sheet).getByRole('button', { name: 'Create role' }));
    const confirm = within(sheet).getByRole('region', { name: 'Confirm change' });
    expect(confirm).toHaveTextContent('Central');
    expect(confirm).toHaveTextContent('0 assignments');
  });
});
