// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvitationAcceptance } from '@/features/admin/components/InvitationAcceptance';

const messages = { memberAdmin: { acceptInvitation: 'Accept invitation', acceptInviteDescription: 'Accept this invitation to join your school.', acceptingInvitation: 'Accepting…', invitationAccepted: 'Invitation accepted.', continueToApp: 'Go to learning', continueToAdmin: 'Go to Admin', inviteAcceptError: 'This invitation could not be accepted. Try again.', retry: 'Retry' } };
const token = 'a'.repeat(43);
function Provider({ children }: { children: React.ReactNode }) { return <NextIntlClientProvider locale="en" messages={messages}>{children}</NextIntlClientProvider>; }
function data(value: unknown, status = 200) { return new Response(JSON.stringify({ data: value }), { status, headers: { 'Content-Type': 'application/json' } }); }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('InvitationAcceptance', () => {
  it('does not accept an invitation until the visitor explicitly confirms', async () => {
    const fetchMock = vi.fn(async () => data({ accepted: true, branchId: 'ans' }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><InvitationAcceptance token={token} destination="/admin" canAccessAdmin /></Provider>);
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('link', { name: 'Go to Admin' })).toHaveAttribute('href', '/admin');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/invitations/accept', expect.objectContaining({ method: 'POST', body: JSON.stringify({ token }) }));
  });

  it('shows a retryable failure without exposing invitation details', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 410, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(data({ accepted: true, branchId: 'ans' }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><InvitationAcceptance token={token} destination="/app" canAccessAdmin={false} /></Provider>);
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation could not be accepted. Try again.');
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Go to learning' })).toHaveAttribute('href', '/app');
  });
});
