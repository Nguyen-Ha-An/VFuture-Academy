// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { BranchesManager } from '@/features/admin/components/BranchesManager';
import { UsersManager } from '@/features/admin/components/UsersManager';
import { AnalyticsDashboard } from '@/features/admin/components/AnalyticsDashboard';

const messages = staffUiTestMessages(en, 'en');

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={messages}>{children}</NextIntlClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

const reportCells = { activeLearners30d: 12, enrollments: 40, completedEnrollments: 10, completionPercent: 25, pendingGrading: 3, averagePercent: 81.5 };

describe('branch admin page', () => {
  it('creates a school from the "New school" sheet and lists it once in the table', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({
      data: { id: 'hcmc', name: 'HCMC', city: 'Ho Chi Minh City', createdAt: '2026-09-03' },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<Provider><BranchesManager initialBranches={[]} canManage /></Provider>);
    expect(screen.queryByLabelText('Branch ID')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New school' }));
    const sheet = screen.getByRole('dialog', { name: 'New school' });
    await user.type(within(sheet).getByLabelText('Branch ID'), 'hcmc');
    await user.type(within(sheet).getByLabelText('Name'), 'HCMC');
    await user.type(within(sheet).getByLabelText('City'), 'Ho Chi Minh City');
    await user.click(within(sheet).getByRole('button', { name: 'Create branch' }));

    expect(await screen.findByRole('cell', { name: 'Ho Chi Minh City' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'HCMC' })).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/studio/branches', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ id: 'hcmc', name: 'HCMC', city: 'Ho Chi Minh City' });
  });

  it('edits a school in the same sheet and replaces its row instead of adding one', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({
      data: { id: 'ans', name: 'ANS Hanoi', city: 'Ha Noi', createdAt: '2026-09-01' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<Provider><BranchesManager initialBranches={[{ id: 'ans', name: 'ANS', city: null, createdAt: '2026-09-01' }]} canManage /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Actions for ANS' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit school' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit school' });
    expect(within(sheet).queryByLabelText('Branch ID')).not.toBeInTheDocument();
    expect(within(sheet).getByText('ans')).toBeInTheDocument();
    await user.clear(within(sheet).getByLabelText('Name'));
    await user.type(within(sheet).getByLabelText('Name'), 'ANS Hanoi');
    await user.type(within(sheet).getByLabelText('City'), 'Ha Noi');
    await user.click(within(sheet).getByRole('button', { name: 'Save branch' }));

    expect(await screen.findByRole('link', { name: 'ANS Hanoi' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'ANS' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/studio/branches/ans', expect.objectContaining({ method: 'PUT' }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ name: 'ANS Hanoi', city: 'Ha Noi' });
  });

  it('keeps the sheet open with an error when saving fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: { message: 'duplicate' } }, 409)));
    const user = userEvent.setup();
    render(<Provider><BranchesManager initialBranches={[]} canManage /></Provider>);
    await user.click(screen.getByRole('button', { name: 'New school' }));
    const sheet = screen.getByRole('dialog', { name: 'New school' });
    await user.type(within(sheet).getByLabelText('Branch ID'), 'ans');
    await user.type(within(sheet).getByLabelText('Name'), 'ANS');
    await user.click(within(sheet).getByRole('button', { name: 'Create branch' }));

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('The change could not be saved.');
    expect(screen.getByRole('dialog', { name: 'New school' })).toBeInTheDocument();
  });

  it('shows report columns only when reports are provided and says Unavailable when they failed', () => {
    const branches = [{ id: 'ans', name: 'ANS', city: 'Ha Noi', createdAt: '2026-09-01' }];
    const { unmount } = render(<Provider><BranchesManager initialBranches={branches} canManage={false} /></Provider>);
    expect(screen.queryByRole('columnheader', { name: 'Average score' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New school' })).not.toBeInTheDocument();
    unmount();

    const ready = render(<Provider><BranchesManager initialBranches={branches} reports={{ ans: reportCells }} canManage={false} /></Provider>);
    const row = screen.getByRole('row', { name: /ANS/ });
    expect(screen.getByRole('columnheader', { name: 'Average score' })).toBeInTheDocument();
    expect(within(row).getByRole('cell', { name: '12' })).toBeInTheDocument();
    expect(within(row).getByRole('cell', { name: '25%' })).toBeInTheDocument();
    expect(within(row).getByRole('cell', { name: '81.5%' })).toBeInTheDocument();
    ready.unmount();

    render(<Provider><BranchesManager initialBranches={branches} reports="unavailable" canManage={false} /></Provider>);
    expect(within(screen.getByRole('row', { name: /ANS/ })).getAllByText('Unavailable')).toHaveLength(5);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('user admin page', () => {
  it('starts global managers with the all-branches filter', () => {
    render(<Provider><UsersManager
      branches={[{ id: 'vinsmc', name: 'VinSMC', city: 'Ha Noi', createdAt: '2026-09-01' }]}
      fixedBranchId={null}
      canManageGlobal
    /></Provider>);

    expect(screen.getByLabelText('Branch')).toHaveValue('');
  });

  it('fixes a branch lead to their branch and exposes labeled branch and role editors', async () => {
    const managedUser = {
      id: 'learner-1', email: 'learner@example.com', handle: 'learner', displayName: 'Learner',
      branchId: 'vinsmc', roles: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(
      String(input).endsWith('/roles')
        ? { data: { ...managedUser, roles: [{ role: 'contributor', branchId: 'vinsmc' }] } }
        : { data: { items: [managedUser], page: 1, pageSize: 20, hasMore: false } },
    ), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<Provider><UsersManager
      branches={[{ id: 'vinsmc', name: 'VinSMC', city: 'Ha Noi', createdAt: '2026-09-01' }]}
      fixedBranchId="vinsmc"
      canManageGlobal={false}
    /></Provider>);
    expect(screen.getByLabelText('Branch').hasAttribute('disabled')).toBe(true);
    await user.type(screen.getByLabelText('Search by email or handle'), 'learner');
    await user.click(screen.getByRole('button', { name: 'Search users' }));

    expect(await screen.findByText(/learner@example\.com/)).toBeDefined();
    expect(screen.getByLabelText('Assigned branch for Learner')).toBeDefined();
    expect(screen.getByLabelText('Role for Learner')).toBeDefined();
    await waitFor(() => expect(String(fetchMock.mock.calls[0]?.[0])).toContain('branchId=vinsmc'));

    await user.click(screen.getByRole('button', { name: 'Grant role' }));
    const roleRequest = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/roles'));
    expect(JSON.parse(String(roleRequest?.[1]?.body))).toMatchObject({
      role: 'instructor', branchId: 'vinsmc', enabled: true,
    });
  });

  it('requires Global to grant content roles while keeping legacy scoped revocation available', async () => {
    const managed = {
      id: 'learner-1', email: 'learner@example.com', handle: 'learner', displayName: 'Learner',
      branchId: 'vinsmc', roles: [{ role: 'contributor', branchId: 'vinsmc' }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).endsWith('/roles')
        ? { data: { ...managed, roles: [] } }
        : { data: { items: [managed], page: 1, pageSize: 20, hasMore: false } },
    ), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><UsersManager
      branches={[{ id: 'vinsmc', name: 'VinSMC', city: null, createdAt: '' }]}
      fixedBranchId={null}
      canManageGlobal
    /></Provider>);
    await user.type(screen.getByLabelText('Search by email or handle'), 'learner');
    await user.click(screen.getByRole('button', { name: 'Search users' }));

    expect(await screen.findByText(/Contributor and editor roles require Global scope/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant role' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke role' })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('Role scope'), '');
    expect(screen.getByRole('button', { name: 'Grant role' })).toBeEnabled();
  });

  it('lets a branch lead select a legacy contributor only for revocation', async () => {
    const managed = {
      id: 'learner-1', email: 'learner@example.com', handle: 'learner', displayName: 'Learner',
      branchId: 'vinsmc', roles: [{ role: 'contributor', branchId: 'vinsmc' }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { items: [managed], page: 1, pageSize: 20, hasMore: false },
    }), { headers: { 'Content-Type': 'application/json' } })));
    const user = userEvent.setup();
    render(<Provider><UsersManager
      branches={[{ id: 'vinsmc', name: 'VinSMC', city: null, createdAt: '' }]}
      fixedBranchId="vinsmc"
      canManageGlobal={false}
    /></Provider>);
    await user.type(screen.getByLabelText('Search by email or handle'), 'learner');
    await user.click(screen.getByRole('button', { name: 'Search users' }));
    await user.selectOptions(await screen.findByLabelText('Role for Learner'), 'contributor');

    expect(screen.getByRole('button', { name: 'Grant role' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke role' })).toBeEnabled();
  });

  it('lets a multi-branch lead select every manageable branch', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      data: { items: [], page: 1, pageSize: 20, hasMore: false },
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<Provider><UsersManager
      branches={[
        { id: 'ans', name: 'ANS', city: 'Ha Noi', createdAt: '2026-09-01' },
        { id: 'vinsmc', name: 'VinSMC', city: 'Ha Noi', createdAt: '2026-09-01' },
      ]}
      fixedBranchId={null}
      canManageGlobal={false}
    /></Provider>);

    const selector = screen.getByLabelText('Branch');
    expect(selector.hasAttribute('disabled')).toBe(false);
    await user.selectOptions(selector, 'vinsmc');
    await user.type(screen.getByLabelText('Search by email or handle'), 'learner');
    await user.click(screen.getByRole('button', { name: 'Search users' }));
    await waitFor(() => expect(String(fetchMock.mock.calls[0]?.[0])).toContain('branchId=vinsmc'));
  });

  it('paginates the committed search even when the editable filters change', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      data: { items: [], page: fetchMock.mock.calls.length, pageSize: 20, hasMore: fetchMock.mock.calls.length === 1 },
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><UsersManager branches={[]} fixedBranchId={null} canManageGlobal /></Provider>);

    await user.type(screen.getByLabelText('Search by email or handle'), 'alpha');
    await user.click(screen.getByRole('button', { name: 'Search users' }));
    await screen.findByRole('button', { name: 'Next' });
    await user.clear(screen.getByLabelText('Search by email or handle'));
    await user.type(screen.getByLabelText('Search by email or handle'), 'beta');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('query=alpha');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('page=2');
  });

  it('ignores a stale search response after a newer filter request', async () => {
    let resolveOld!: (response: Response) => void;
    const old = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => old)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {
        items: [{ id: 'new', email: 'new@example.com', handle: 'new', displayName: 'New result', branchId: null, roles: [] }],
        page: 1, pageSize: 20, hasMore: false,
      } }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><UsersManager branches={[]} fixedBranchId={null} canManageGlobal /></Provider>);

    await user.type(screen.getByLabelText('Search by email or handle'), 'old');
    await user.click(screen.getByRole('button', { name: 'Search users' }));
    await user.clear(screen.getByLabelText('Search by email or handle'));
    await user.type(screen.getByLabelText('Search by email or handle'), 'new');
    await user.click(screen.getByRole('button', { name: 'Search users' }));
    expect(await screen.findByText('New result')).toBeInTheDocument();

    resolveOld(new Response(JSON.stringify({ data: {
      items: [{ id: 'old', email: 'old@example.com', handle: 'old', displayName: 'Old result', branchId: null, roles: [] }],
      page: 1, pageSize: 20, hasMore: false,
    } }), { headers: { 'Content-Type': 'application/json' } }));
    await old;
    expect(screen.getByText('New result')).toBeInTheDocument();
    expect(screen.queryByText('Old result')).not.toBeInTheDocument();
  });

  it('renders the durable returned branch and safe server mutation error', async () => {
    const managed = { id: 'learner-1', email: 'learner@example.com', handle: 'learner', displayName: 'Learner', branchId: 'ans', roles: [] };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/branch')) return new Response(JSON.stringify({ data: managed }), { headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/roles')) return new Response(JSON.stringify({ error: { message: 'The final global admin cannot be revoked' } }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ data: { items: [managed], page: 1, pageSize: 20, hasMore: false } }), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><UsersManager
      branches={[{ id: 'ans', name: 'ANS', city: null, createdAt: '' }, { id: 'vinsmc', name: 'VinSMC', city: null, createdAt: '' }]}
      fixedBranchId={null}
      canManageGlobal
    /></Provider>);
    await user.type(screen.getByLabelText('Search by email or handle'), 'learner');
    await user.click(screen.getByRole('button', { name: 'Search users' }));
    await user.selectOptions(await screen.findByLabelText('Assigned branch for Learner'), 'vinsmc');
    await user.click(screen.getByRole('button', { name: 'Assign branch' }));
    await waitFor(() => expect(screen.getByLabelText('Assigned branch for Learner')).toHaveValue('ans'));

    await user.click(screen.getByRole('button', { name: 'Revoke role' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The final global admin cannot be revoked');
  });
});

describe('branch analytics page', () => {
  it('renders a fixed branch for leads with accessible summary and course tables', () => {
    render(<Provider><AnalyticsDashboard
      branches={[{ id: 'vinsmc', name: 'VinSMC', city: 'Ha Noi', createdAt: '2026-09-01' }]}
      fixedBranchId="vinsmc"
      initialData={{
        branchId: 'vinsmc',
        period: { from: '2026-08-05', to: '2026-09-03' },
        activeLearners: { days7: 5, days30: 10 },
        enrollments: 3,
        lessonCompletionRate: 62.5,
        attempts: { quiz: 3, exam: 2 },
        pendingGradingCount: 4,
        courses: [{ courseId: 'ai-1', quizAttempts: 3, examAttempts: 2, averagePercent: 78.5 }],
        topFailedQuestions: [{ courseId: 'ai-1', questionId: 'q-hard', failures: 7, attempts: 10, failureRate: 70 }],
      }}
    /></Provider>);

    expect(screen.getByRole('heading', { name: 'Branch analytics' })).toBeDefined();
    expect(screen.getByLabelText('Branch').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('img', { name: 'Lesson completion rate: 62.5%' })).toBeDefined();
    expect(screen.getByRole('table', { name: 'Course performance' })).toBeDefined();
    expect(screen.getByRole('table', { name: 'Top failed questions' })).toBeDefined();
  });

  it('lets a multi-branch lead select and load any readable branch', async () => {
    const initialData = {
      branchId: 'ans',
      period: { from: '2026-08-05', to: '2026-09-03' },
      activeLearners: { days7: 0, days30: 0 },
      enrollments: 0,
      lessonCompletionRate: 0,
      attempts: { quiz: 0, exam: 0 },
      pendingGradingCount: 0,
      courses: [],
      topFailedQuestions: [],
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      data: { ...initialData, branchId: 'vinsmc' },
    }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<Provider><AnalyticsDashboard
      branches={[
        { id: 'ans', name: 'ANS', city: 'Ha Noi', createdAt: '2026-09-01' },
        { id: 'vinsmc', name: 'VinSMC', city: 'Ha Noi', createdAt: '2026-09-01' },
      ]}
      fixedBranchId={null}
      initialData={initialData}
    /></Provider>);

    const selector = screen.getByLabelText('Branch');
    expect(selector.hasAttribute('disabled')).toBe(false);
    await user.selectOptions(selector, 'vinsmc');
    await user.click(screen.getByRole('button', { name: 'Load analytics' }));
    await waitFor(() => expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/branch/vinsmc'));
  });

  it('deduplicates analytics loads and ignores an older branch response', async () => {
    const snapshot = (branchId: string, days7: number) => ({
      branchId, period: { from: '2026-08-05', to: '2026-09-03' },
      activeLearners: { days7, days30: days7 }, enrollments: 0, lessonCompletionRate: 0,
      attempts: { quiz: 0, exam: 0 }, pendingGradingCount: 0, courses: [], topFailedQuestions: [],
    });
    let resolveVin!: (response: Response) => void;
    let resolveAns!: (response: Response) => void;
    const vin = new Promise<Response>((resolve) => { resolveVin = resolve; });
    const ans = new Promise<Response>((resolve) => { resolveAns = resolve; });
    const fetchMock = vi.fn((input: RequestInfo | URL) => String(input).endsWith('/vinsmc') ? vin : ans);
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><AnalyticsDashboard
      branches={[{ id: 'ans', name: 'ANS', city: null, createdAt: '' }, { id: 'vinsmc', name: 'VinSMC', city: null, createdAt: '' }]}
      fixedBranchId={null}
      initialData={snapshot('ans', 1)}
    /></Provider>);

    await user.selectOptions(screen.getByLabelText('Branch'), 'vinsmc');
    const load = screen.getByRole('button', { name: 'Load analytics' });
    load.click();
    load.click();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.selectOptions(screen.getByLabelText('Branch'), 'ans');
    await user.click(load);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveAns(new Response(JSON.stringify({ data: snapshot('ans', 9) }), { headers: { 'Content-Type': 'application/json' } }));
    await waitFor(() => expect(screen.getAllByText('9')).toHaveLength(2));
    resolveVin(new Response(JSON.stringify({ data: snapshot('vinsmc', 4) }), { headers: { 'Content-Type': 'application/json' } }));
    await vin;
    await waitFor(() => expect(screen.queryByText('4')).not.toBeInTheDocument());
  });
});
