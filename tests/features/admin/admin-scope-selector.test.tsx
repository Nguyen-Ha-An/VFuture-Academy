// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';
import { AdminScopeSelector } from '@/features/admin/components/AdminScopeSelector';
import { registerNavigationGuard } from '@/lib/navigation-guard';
const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const options = [
  { scope: { kind: 'branch' as const, branchId: 'ans' }, label: 'ANS', permissions: [] },
  { scope: { kind: 'branch' as const, branchId: 'dewey' }, label: 'Dewey', permissions: [] },
];
function view(scopes = options, destination?: string, endpoint?: string) {
  return render(<NextIntlClientProvider locale="en" messages={messages}><AdminScopeSelector options={scopes} active={options[0].scope} destination={destination} endpoint={endpoint} /></NextIntlClientProvider>);
}
describe('Admin scope selector', () => {
  it('does not change scope or hide the editor when its navigation guard cancels', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const unregister = registerNavigationGuard(async () => false);
    try {
      view();
      await userEvent.selectOptions(screen.getByRole('combobox'), 'branch:dewey');
      expect(request).not.toHaveBeenCalled();
      expect(nav.replace).not.toHaveBeenCalled();
      expect(screen.getByRole('combobox')).toHaveValue('branch:ans');
      expect(screen.getByRole('combobox')).toBeEnabled();
    } finally { unregister(); }
  });
  it('fixes one-school users to their authorized scope', () => {
    view([options[0]]);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.queryByRole('option', { name: /Central/ })).not.toBeInTheDocument();
  });
  it('persists a new scope before navigating to a clean dashboard', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({data:{ok:true}}),{status:200}));
    vi.stubGlobal('fetch', request);
    view();
    await userEvent.selectOptions(screen.getByRole('combobox'), 'branch:dewey');
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/admin'));
    expect(request).toHaveBeenCalledWith('/api/v1/admin/scope', expect.objectContaining({method:'POST',signal:expect.any(AbortSignal),body:JSON.stringify({scope:'branch:dewey'})}));
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
  it('shows denial without switching visible scope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}',{status:403})));
    view();
    await userEvent.selectOptions(screen.getByRole('combobox'), 'branch:dewey');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toHaveValue('branch:ans');
  });
  it('supports the Studio scope endpoint and destination', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({data:{scope:'branch:dewey'}}), {status:200}));
    vi.stubGlobal('fetch', request);
    view(options, '/studio', '/api/v1/studio/scope');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'branch:dewey');
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/studio'));
    expect(request).toHaveBeenCalledWith('/api/v1/studio/scope', expect.objectContaining({ body: JSON.stringify({scope:'branch:dewey'}) }));
  });
});
