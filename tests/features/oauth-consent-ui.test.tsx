// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsentPanel } from '@/features/oauth-consent/ConsentPanel';
import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';

const callback = 'https://claude.ai/api/mcp/auth_callback';
const ready = {
  kind: 'ready' as const,
  authorizationId: 'authorization-1',
  callback,
  host: 'claude.ai',
  clientName: 'Friendly Quiz Helper',
  scopes: ['openid', 'email', 'offline_access'],
  accountEmail: 'editor@example.com',
};

function show(state: Parameters<typeof ConsentPanel>[0]['state'], locale: 'en' | 'vi' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : viMessages}>
      <ConsentPanel state={state} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Studio OAuth consent panel', () => {
  it('shows the verified host ahead of the untrusted client name and states token scope', () => {
    show(ready);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('claude.ai');
    expect(screen.getByText('Friendly Quiz Helper')).toBeInTheDocument();
    expect(screen.getByText('offline_access')).toBeInTheDocument();
    expect(screen.getByText(/Supabase OAuth session/i)).toBeInTheDocument();
    expect(screen.getByText(/Studio MCP tools cannot save, publish, or delete/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /allow connection/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /deny/i })).toBeEnabled();
  });

  it('shows the exact ChatGPT callback for comparison with the AI app', () => {
    const chatgptCallback = 'https://chatgpt.com/connector/oauth/AbCd1234EfGh';
    show({ ...ready, callback: chatgptCallback, host: 'chatgpt.com' });
    expect(screen.getByText(chatgptCallback)).toBeInTheDocument();
    expect(screen.getByText(/compare this exact callback/i)).toBeInTheDocument();
  });

  it('offers only Deny for an unsafe callback', () => {
    show({ kind: 'unsafe', authorizationId: 'authorization-1' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('not approved');
    expect(screen.getByRole('button', { name: /deny/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /allow connection/i })).not.toBeInTheDocument();
  });

  it('explains an expired authorization without an approval control', () => {
    show({ kind: 'expired' });
    expect(screen.getByText(/start again from your AI app/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /allow connection/i })).not.toBeInTheDocument();
  });

  it('uses Vietnamese copy and retains both actions', () => {
    show(ready, 'vi');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('claude.ai');
    expect(screen.getByText(callback)).toBeInTheDocument();
    expect(screen.getByText(/so sánh chính xác địa chỉ/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cho phép kết nối/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /từ chối/i })).toBeEnabled();
  });

  it('sends an explicit same-origin JSON decision and shows an error on failed response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code: 'RATE_LIMITED' } }), { status: 429 }));
    show(ready);
    fireEvent.click(screen.getByRole('button', { name: /allow connection/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/try again/i));
    expect(fetch).toHaveBeenCalledWith('/api/v1/oauth/consent', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authorizationId: 'authorization-1', decision: 'approve' }),
    }));
  });
});
