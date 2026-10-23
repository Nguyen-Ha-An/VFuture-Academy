// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { McpBlockView } from '@/features/admin/components/McpBlockView';
import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const userId = '00000000-0000-4000-8000-000000000123';
const otherUserId = '00000000-0000-4000-8000-000000000789';
const actorId = '00000000-0000-4000-8000-000000000456';

function blockStatus(id: string, blocked = false, reason: string | null = null) {
  return {
    userId: id,
    blocked,
    reason,
    blockedAt: blocked ? '2026-09-26T08:00:00.000Z' : null,
    blockedBy: blocked ? actorId : null,
    scope: 'all-mcp-clients',
    oauthGrantRevoked: false,
  };
}

function data(value: unknown, status = 200) {
  return new Response(JSON.stringify({ data: value }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function view(initialUserId = '', locale: 'en' | 'vi' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={staffUiTestMessages(locale === 'en' ? en : viMessages, locale)}>
      <McpBlockView initialUserId={initialUserId} actorId={actorId} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MCP access block view', () => {
  it('rejects an invalid UUID before requesting a status', async () => {
    const fetchMock = vi.fn(async () => data(blockStatus(userId)));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    view();

    await user.type(screen.getByRole('textbox', { name: 'User ID' }), 'not-a-uuid');
    await user.click(screen.getByRole('button', { name: 'Check access' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid user UUID.');
    expect(screen.getByRole('textbox', { name: 'User ID' })).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(screen.getByRole('textbox', { name: 'User ID' }));
    expect(screen.queryByText('Enter a valid user UUID.')).not.toBeInTheDocument();
  });

  it('loads a prefilled user status with the central scope and actor, then shows block details', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => data(blockStatus(userId, true, 'Security review')));
    vi.stubGlobal('fetch', fetchMock);
    view(userId);

    expect(await screen.findByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Security review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unblock MCP access' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({ cache: 'no-store', signal: expect.any(AbortSignal) });
    expect(new URLSearchParams(String(url).split('?')[1])).toEqual(new URLSearchParams({
      scope: 'central', actorId, userId,
    }));
  });

  it('requires confirmation before blocking and sends the trimmed reason in a POST', async () => {
    let blocked = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        blocked = true;
        return new Response(null, { status: 204 });
      }
      return data(blockStatus(userId, blocked));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    view(userId);
    await screen.findByText('Not blocked');

    await user.click(screen.getByRole('button', { name: 'Block MCP access' }));
    expect(screen.getByRole('dialog', { name: 'Block MCP access?' })).toHaveTextContent(userId);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Block MCP access' }));
    await user.type(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Reason (optional)' }), '  Security review  ');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Block MCP access' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, request]) => request?.method === 'POST')!;
    expect(String(url)).toBe(`/api/v1/admin/mcp/blocks?scope=central&actorId=${actorId}`);
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({ userId, reason: 'Security review' });
    expect(await screen.findByRole('status')).toHaveTextContent('MCP access blocked.');
    expect(await screen.findByText('Blocked')).toBeInTheDocument();
  });

  it('requires confirmation before unblocking and sends a DELETE for the selected user', async () => {
    let blocked = true;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        blocked = false;
        return new Response(null, { status: 204 });
      }
      return data(blockStatus(userId, blocked, blocked ? 'Review complete' : null));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    view(userId);
    await screen.findByText('Blocked');

    await user.click(screen.getByRole('button', { name: 'Unblock MCP access' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    await user.click(within(screen.getByRole('dialog', { name: 'Unblock MCP access?' })).getByRole('button', { name: 'Unblock MCP access' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, request]) => request?.method === 'DELETE')!;
    expect(String(url)).toBe(`/api/v1/admin/mcp/blocks?scope=central&actorId=${actorId}`);
    expect(JSON.parse(String(init?.body))).toEqual({ userId });
    expect(await screen.findByText('Not blocked')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('MCP access unblocked.');
  });

  it('ignores an older lookup response after the user changes targets', async () => {
    const resolvers = new Map<string, (response: Response) => void>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => new Promise<Response>((resolve) => {
      const id = new URL(String(input), 'http://localhost').searchParams.get('userId')!;
      resolvers.set(id, resolve);
    }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    view();
    const input = screen.getByRole('textbox', { name: 'User ID' });

    await user.type(input, userId);
    await user.click(screen.getByRole('button', { name: 'Check access' }));
    await waitFor(() => expect(resolvers.has(userId)).toBe(true));
    await user.clear(input);
    await user.type(input, otherUserId);
    await user.click(screen.getByRole('button', { name: 'Check access' }));
    await waitFor(() => expect(resolvers.has(otherUserId)).toBe(true));

    await act(async () => { resolvers.get(otherUserId)!(data(blockStatus(otherUserId))); });
    expect(await screen.findByText('Not blocked')).toBeInTheDocument();
    expect(screen.getByText(otherUserId)).toBeInTheDocument();
    await act(async () => { resolvers.get(userId)!(data(blockStatus(userId, true, 'Stale block'))); });
    expect(screen.queryByText('Stale block')).not.toBeInTheDocument();
    expect(screen.getByText(otherUserId)).toBeInTheDocument();
  });

  it('shows a failed lookup and lets the administrator retry', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async () => ++attempts === 1
      ? data(null, 500)
      : data(blockStatus(userId)));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    view(userId);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check MCP access. Try again.');
    expect(screen.queryByText('Not blocked')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Not blocked')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the confirmation open and reports a failed write without claiming success', async () => {
    let writes = 0;
    let blocked = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        writes += 1;
        if (writes === 1) return new Response(null, { status: 500 });
        blocked = true;
        return new Response(null, { status: 204 });
      }
      return data(blockStatus(userId, blocked));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    view(userId);
    await screen.findByText('Not blocked');
    await user.click(screen.getByRole('button', { name: 'Block MCP access' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason (optional)' }), 'Incident');
    await user.click(within(dialog).getByRole('button', { name: 'Block MCP access' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not update the MCP block. Try again.');
    expect(within(dialog).getByRole('textbox', { name: 'Reason (optional)' })).toHaveValue('Incident');
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(screen.getByText('Not blocked')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Block MCP access' }));
    expect(await screen.findByText('Blocked')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('MCP access blocked.');
    expect(writes).toBe(2);
  });

  it.each([
    {
      locale: 'en' as const,
      title: 'OAuth grant is separate',
      explanation: 'A Central MCP block does not revoke an existing Supabase OAuth grant or session. Share Connected apps with this person so they can revoke their own OAuth grant.',
      link: 'Connected apps · /account/connected-apps',
    },
    {
      locale: 'vi' as const,
      title: 'Quyền cấp OAuth riêng biệt',
      explanation: 'Chặn MCP tại Central không thu hồi quyền cấp hoặc phiên Supabase OAuth hiện có. Hãy chia sẻ trang Ứng dụng đã kết nối với người này để họ tự thu hồi quyền cấp OAuth.',
      link: 'Ứng dụng đã kết nối · /account/connected-apps',
    },
  ])('explains the separate OAuth grant and links to Connected apps in $locale', ({ locale, title, explanation, link }) => {
    view('', locale);

    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(screen.getByText(explanation)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: link })).toHaveAttribute('href', '/account/connected-apps');
  });
});
