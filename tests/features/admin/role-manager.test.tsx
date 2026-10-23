// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoleManager, groupPermissions, permissionGroupMessageKey, permissionMessageKey } from '@/features/admin/components/RoleManager';
import { PERMISSIONS, PERMISSION_DEFINITIONS } from '@/lib/authorization';
import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { staffUiMessages, staffUiTestMessages } from '@/messages/staff-ui';

const messages = staffUiTestMessages(en, 'en');
const scope = { kind: 'branch' as const, branchId: 'ans' };
const builtIn = { id: 'school-admin', name: 'School admin', description: 'Manage a school', scopeKind: 'branch' as const, permissions: ['member.read', 'role.definition.read'], builtIn: true, grantableBySchool: true, version: 1, assignmentCount: 2 };
const custom = { id: 'mentor', name: 'Mentor', description: '', scopeKind: 'branch' as const, permissions: ['member.read'], builtIn: false, grantableBySchool: false, version: 3, assignmentCount: 4 };
const options = {
  scope,
  branches: [{ id: 'ans', name: 'ANS' }],
  roles: [builtIn],
  permissions: ['member.read', 'member.manage', 'membership.manage', 'role.definition.manage', 'role.definition.read', 'content.publish'],
};

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={messages}>{children}</NextIntlClientProvider>;
}

function data(value: unknown, status = 200) {
  return new Response(JSON.stringify({ data: value }), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubRoles(roles: unknown[], extra?: (input: string, init?: RequestInit) => Response | undefined, permissions = options.permissions) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const override = extra?.(url, init);
    if (override) return override;
    if (url.includes('/options')) return data({ ...options, permissions });
    return data(roles);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RoleManager', () => {
  it('opens "New role" in a sheet and posts a role only after the footer confirm step', async () => {
    const fetchMock = stubRoles([builtIn], (_url, init) => init?.method === 'POST'
      ? data({ ...builtIn, id: 'custom-role', name: 'Mentor', builtIn: false, assignmentCount: 0 }, 201)
      : undefined);
    const user = userEvent.setup();
    render(<Provider><RoleManager scope={scope} /></Provider>);
    expect(await screen.findByRole('heading', { name: 'Roles & permissions' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Role name')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'New role' }));
    const sheet = screen.getByRole('dialog', { name: 'Create role' });
    await user.type(within(sheet).getByLabelText('Role name'), 'Mentor');
    await user.click(within(sheet).getByRole('checkbox', { name: /View members/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Create role' }));

    const confirm = within(sheet).getByRole('region', { name: 'Confirm change' });
    expect(confirm).toHaveTextContent('Mentor · School · View members');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await user.click(within(confirm).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ name: 'Mentor', scopeKind: 'branch', permissions: ['member.read'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('row', { name: /Mentor/ })).toBeInTheDocument();
  });

  it('names the selected role scope and assignment impact in the confirmation', async () => {
    stubRoles([builtIn]);
    const user = userEvent.setup();
    render(<Provider><RoleManager scope={scope} /></Provider>);
    await user.click(await screen.findByRole('button', { name: 'New role' }));
    const sheet = screen.getByRole('dialog', { name: 'Create role' });
    await user.type(within(sheet).getByLabelText('Role name'), 'Mentor');
    await user.selectOptions(within(sheet).getByLabelText('Scope'), 'central');
    await user.click(within(sheet).getByRole('button', { name: 'Create role' }));

    const confirm = within(sheet).getByRole('region', { name: 'Confirm change' });
    expect(confirm).toHaveTextContent('Central');
    expect(confirm).toHaveTextContent('0 assignments');
    await user.click(within(confirm).getByRole('button', { name: 'Back to editing' }));
    expect(within(sheet).queryByRole('region', { name: 'Confirm change' })).not.toBeInTheDocument();
    expect(within(sheet).getByLabelText('Role name')).toHaveValue('Mentor');
  });

  it('hides central-only permissions for school roles and shows grouped readable labels with raw codes', async () => {
    stubRoles([builtIn]);
    const user = userEvent.setup();
    render(<Provider><RoleManager scope={scope} /></Provider>);
    await user.click(await screen.findByRole('button', { name: 'New role' }));
    const sheet = screen.getByRole('dialog', { name: 'Create role' });
    expect(within(sheet).queryByRole('checkbox', { name: /Publish content/ })).not.toBeInTheDocument();
    expect(within(sheet).getByRole('group', { name: 'Members' })).toHaveTextContent('member.manage');
    await user.selectOptions(within(sheet).getByLabelText('Scope'), 'central');
    expect(within(sheet).getByRole('checkbox', { name: /Publish content/ })).toBeInTheDocument();
  });

  it('lists roles in a table with type badge, grouped permissions and a filtered members link', async () => {
    stubRoles([builtIn, custom]);
    const user = userEvent.setup();
    render(<Provider><RoleManager scope={scope} /></Provider>);
    const builtInRow = await screen.findByRole('row', { name: /School admin/ });
    expect(within(builtInRow).getByText('Built-in')).toBeInTheDocument();
    expect(within(builtInRow).getByRole('link', { name: /2 assignments/ })).toHaveAttribute('href', '/admin/users?memberRole=school-admin');
    // The row menu of a built-in role never offers Edit.
    await user.click(within(builtInRow).getByRole('button', { name: 'Actions for School admin' }));
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    // The permission count opens the role in a sheet with grouped, readable labels.
    await user.click(within(builtInRow).getByRole('button', { name: /2 permissions/ }));
    const details = screen.getByRole('dialog', { name: 'School admin' });
    expect(within(details).getByText('View role definitions')).toBeInTheDocument();
    expect(within(details).getByText('role.definition.read')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    const customRow = screen.getByRole('row', { name: /Mentor/ });
    expect(within(customRow).getByText('Custom')).toBeInTheDocument();
    await user.click(within(customRow).getByRole('button', { name: 'Actions for Mentor' }));
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
  });

  it('names built-in roles in the UI language and keeps custom names', async () => {
    stubRoles([{ ...builtIn, id: 'teacher', name: 'Teacher' }, custom]);
    render(<NextIntlClientProvider locale="vi" messages={staffUiTestMessages(viMessages, 'vi')}><RoleManager scope={scope} /></NextIntlClientProvider>);
    expect(await screen.findByRole('row', { name: /Giáo viên/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Mentor/ })).toBeInTheDocument();
  });

  it('shows the assignment count as text without member.read, never a forbidden link', async () => {
    stubRoles([builtIn], undefined, ['role.definition.read']);
    render(<Provider><RoleManager scope={scope} /></Provider>);
    const row = await screen.findByRole('row', { name: /School admin/ });
    expect(within(row).getByText('2 assignments')).toBeInTheDocument();
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
  });

  it('edits a custom role in the same sheet with a locked scope and PATCHes its version', async () => {
    const fetchMock = stubRoles([builtIn, custom], (_url, init) => init?.method === 'PATCH'
      ? data({ ...custom, name: 'Senior mentor', version: 4 })
      : undefined);
    const user = userEvent.setup();
    render(<Provider><RoleManager scope={scope} /></Provider>);
    await user.click(await screen.findByRole('button', { name: 'Actions for Mentor' }));
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const sheet = screen.getByRole('dialog', { name: 'Update role' });
    expect(within(sheet).getByLabelText('Scope')).toBeDisabled();
    await user.clear(within(sheet).getByLabelText('Role name'));
    await user.type(within(sheet).getByLabelText('Role name'), 'Senior mentor');
    await user.click(within(sheet).getByRole('button', { name: 'Update role' }));
    expect(within(sheet).getByRole('region', { name: 'Confirm change' })).toHaveTextContent('4 assignments');
    await user.click(within(sheet).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(screen.getByRole('row', { name: /Senior mentor/ })).toBeInTheDocument());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(String(patch?.[0])).toContain('/api/v1/admin/roles/mentor');
    expect(JSON.parse(String(patch?.[1]?.body))).toMatchObject({ name: 'Senior mentor', version: 3 });
  });

  it('keeps the confirm step open with an error when saving fails', async () => {
    stubRoles([builtIn], (_url, init) => init?.method === 'POST'
      ? new Response(JSON.stringify({ error: { message: 'conflict' } }), { status: 409, headers: { 'Content-Type': 'application/json' } })
      : undefined);
    const user = userEvent.setup();
    render(<Provider><RoleManager scope={scope} /></Provider>);
    await user.click(await screen.findByRole('button', { name: 'New role' }));
    const sheet = screen.getByRole('dialog', { name: 'Create role' });
    await user.type(within(sheet).getByLabelText('Role name'), 'Mentor');
    await user.click(within(sheet).getByRole('button', { name: 'Create role' }));
    await user.click(within(sheet).getByRole('button', { name: 'Confirm' }));
    expect(await within(sheet).findByRole('alert')).toBeInTheDocument();
    expect(within(sheet).getByRole('region', { name: 'Confirm change' })).toBeInTheDocument();
  });

  it('is read only without the definition-management permission', async () => {
    stubRoles([builtIn, custom], undefined, ['member.read', 'role.definition.read']);
    render(<Provider><RoleManager scope={scope} /></Provider>);
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New role' })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Actions for Mentor' }));
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
  });
});

describe('permission labels', () => {
  it('has a readable vi and en label for every permission and group', () => {
    for (const locale of ['en', 'vi'] as const) {
      const org = (staffUiMessages(locale).admin as { org: { permissionLabels: Record<string, string>; permissionGroups: Record<string, string> } }).org;
      for (const permission of PERMISSIONS) expect(org.permissionLabels[permissionMessageKey(permission)], `${locale} ${permission}`).toBeTruthy();
      const groups = new Set(PERMISSIONS.map((permission) => PERMISSION_DEFINITIONS[permission].group));
      for (const group of groups) expect(org.permissionGroups[permissionGroupMessageKey(group)], `${locale} ${group}`).toBeTruthy();
      expect(Object.keys(org.permissionLabels)).toHaveLength(PERMISSIONS.length);
      expect(Object.keys(org.permissionGroups)).toHaveLength(groups.size);
    }
  });

  it('groups permissions in catalogue order', () => {
    expect(groupPermissions(['audit.read', 'member.manage', 'member.read'])).toEqual([
      { group: 'members', permissions: ['member.read', 'member.manage'] },
      { group: 'audit', permissions: ['audit.read'] },
    ]);
  });
});
