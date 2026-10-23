// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectedAppsPanel } from '@/features/account/connected-apps/ConnectedAppsPanel';

const clientId = '00000000-0000-4000-8000-000000000123';
const ready = { kind: 'ready' as const, apps: [{ clientId, name: 'Course helper', scopes: ['openid', 'email'], grantedAt: '2026-09-20T00:00:00Z' }] };

function show(state: Parameters<typeof ConnectedAppsPanel>[0]['state'] = ready, locale: 'en' | 'vi' = 'en') {
  return render(<ConnectedAppsPanel state={state} accountEmail="editor@example.com" locale={locale} theme="system" />);
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('connected apps account panel', () => {
  it('shows the signed-in account and scopes without any client-controlled URL', () => {
    show();
    expect(screen.getByRole('heading', { level: 1, name: 'Connected apps' })).toBeInTheDocument();
    expect(screen.getByText('editor@example.com')).toBeInTheDocument();
    expect(screen.getByText('Course helper')).toBeInTheDocument();
    expect(screen.getByText('openid')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(document.querySelector('a[href^="http"], img[src^="http"]')).toBeNull();
  });

  it('requires an explicit confirmation and sends same-origin JSON for that client', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { revoked: true } }), { status: 200 }));
    show();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Course helper' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/previously issued access tokens may remain usable until they expire/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Remove access' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Course helper' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/account/oauth-grants', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }),
    }));
    await waitFor(() => expect(screen.queryByText('Course helper')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent(/authorization removed/i);
  });

  it('keeps the grant visible and announces a failed revoke', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: { code: 'GRANT_REVOKE_UNAVAILABLE' } }), { status: 503 }));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Course helper' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not remove/i));
    expect(screen.getByText('Course helper')).toBeInTheDocument();
  });

  it('does not announce revocation on an unexpected success response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { revoked: false } }), { status: 200 }));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Course helper' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove access' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not remove/i));
    expect(screen.getByText('Course helper')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('distinguishes an empty list from a failed load and includes Vietnamese copy', () => {
    show({ kind: 'ready', apps: [] }, 'vi');
    expect(screen.getByRole('heading', { level: 1, name: 'Ứng dụng đã kết nối' })).toBeInTheDocument();
    expect(screen.getByText(/chưa cấp quyền/i)).toBeInTheDocument();
    cleanup();
    show({ kind: 'unavailable' }, 'vi');
    expect(screen.getByRole('alert')).toHaveTextContent(/không thể tải/i);
    expect(screen.queryByText(/chưa cấp quyền/i)).not.toBeInTheDocument();
  });
});
