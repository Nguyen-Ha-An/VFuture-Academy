// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import { StaffWorkspaceShell } from '@/features/staff-ui/ui/StaffWorkspaceShell';
import { staffUiTestMessages } from '@/messages/staff-ui';
import en from '@/messages/en.json';

vi.mock('next/navigation', () => ({ usePathname: () => '/studio', useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock('@/features/staff-ui/ui/WorkspaceScopeSwitcher', () => ({ WorkspaceScopeSwitcher: () => <button>Workspace scope</button> }));
vi.mock('@/features/staff-ui/ui/StaffUserMenu', () => ({ StaffUserMenu: () => <button>Account</button> }));
vi.mock('@/features/staff-ui/ui/StaffCommandMenu', () => ({ StaffCommandMenu: () => <button>Search</button> }));
vi.mock('@/features/staff-ui/ui/AttentionPopover', () => ({ AttentionPopover: () => null }));
vi.mock('@/features/staff-ui/ui/StaffThemeMenu', () => ({ StaffThemeMenu: () => null }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps fresh desktop focus on body and the skip link first, without resetting content when the sidebar toggles', async () => {
  window.innerWidth = 1440;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({ get matches() { return query.includes('max-width') && window.innerWidth <= (query.includes('1023') ? 1023 : 767); }, addEventListener: (_event: string, listener: () => void) => listeners.add(listener), removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener) }));
  function Content() { const [draft, setDraft] = useState(''); return <><h1>Studio</h1><input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} /></>; }
  render(<NextIntlClientProvider locale="en" messages={staffUiTestMessages(en, 'en')}><StaffWorkspaceShell workspace="studio" chrome={{ theme: 'light', sidebarOpen: true, identity: { name: 'Author', email: 'author@example.test', avatarUrl: null, initials: 'A' } }} permissions={[]} entries={{ studio: '/studio', grading: null, admin: null }}><Content /></StaffWorkspaceShell></NextIntlClientProvider>);
  await act(() => new Promise(resolve => setTimeout(resolve, 1250)));
  expect(document.activeElement).toBe(document.body);
  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole('link', { name: en.common.skipToContent })).toHaveFocus();
  const draft = screen.getByRole('textbox', { name: 'Draft' });
  await user.type(draft, 'Unsaved content');
  const toggle = screen.getByRole('button', { name: 'Toggle sidebar' });
  await user.click(toggle);
  await user.click(toggle);
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
  expect(draft).toHaveValue('Unsaved content');
  act(() => { window.innerWidth = 390; listeners.forEach(listener => listener()); });
  expect(screen.getByRole('button', { name: en.common.menu })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
  act(() => { window.innerWidth = 1440; listeners.forEach(listener => listener()); });
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
  expect(draft).toHaveValue('Unsaved content');
});
