// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { CanvasProvider } from '@/features/canvas/ui';
import { GlobalNavigation } from '@/features/canvas/ui/GlobalNavigation';
import { WorkspaceScopeSwitcher, type WorkspaceScopeSwitcherProps } from '@/features/staff-ui/ui/WorkspaceScopeSwitcher';
import type { AdminScopeOption } from '@/lib/admin-scope';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import type { WorkspaceEntries } from '@/lib/workspace-navigation';
import en from '@/messages/en.json';
import vi_ from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useServerInsertedHTML: () => undefined, useRouter: () => nav, usePathname: () => '/studio' }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const ALL: WorkspaceEntries = { studio: '/studio', grading: '/grading', admin: '/admin' };
const STUDIO_ONLY: WorkspaceEntries = { studio: '/studio', grading: null, admin: null };
const options: AdminScopeOption[] = [
  { scope: { kind: 'central' }, label: 'Central', permissions: [] },
  { scope: { kind: 'branch', branchId: 'ans' }, label: 'ANS', permissions: [] },
  { scope: { kind: 'branch', branchId: 'dewey' }, label: 'Dewey', permissions: [] },
];

function view(props: Partial<WorkspaceScopeSwitcherProps> = {}, { locale = 'en' as 'en' | 'vi', open = true, rail = false, theme = 'light' as 'light' | 'dark' } = {}) {
  const entries = props.entries ?? ALL;
  return render(<NextIntlClientProvider locale={locale} messages={staffUiTestMessages(locale === 'en' ? en : vi_, locale)}>
    <CanvasProvider theme={theme}><SidebarProvider defaultOpen={open}>
      {rail ? <GlobalNavigation studio={entries.studio} grading={entries.grading} admin={entries.admin} /> : null}
      <WorkspaceScopeSwitcher workspace="studio" entries={entries} scopeOptions={options} activeScope={options[1].scope} {...props} />
    </SidebarProvider></CanvasProvider>
  </NextIntlClientProvider>);
}
function selector(locale: 'en' | 'vi' = 'en') {
  return screen.getByRole('combobox', { name: (locale === 'en' ? en : vi_).centralAdmin.scope });
}
async function openSchools(locale: 'en' | 'vi' = 'en') {
  await userEvent.click(selector(locale));
  return screen.findByRole('listbox');
}
/** Transparent native wrappers do not carry the popup's painted theme surface. */
function background(node: Element): string {
  for (let element: Element | null = node; element; element = element.parentElement) {
    const color = getComputedStyle(element).backgroundColor;
    if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
  }
  throw new Error('Native scope popup has no painted background');
}
function brightness(color: string) {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error('Unrecognized popup colour: ' + color);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

describe('WorkspaceScopeSwitcher', () => {
  it('names the school control and localizes the current Central scope', () => {
    view({ activeScope: options[0].scope });
    expect(selector()).toHaveValue(en.centralAdmin.central);
    expect(selector()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('uses the Vietnamese school label while keeping the authorized school name', () => {
    view({ workspace: 'grading' }, { locale: 'vi' });
    expect(selector('vi')).toHaveValue('ANS');
    expect(selector('vi')).toHaveAccessibleName(vi_.centralAdmin.scope);
  });

  it('keeps the school control accessible when contextual navigation is collapsed', () => {
    view({}, { open: false });
    expect(selector()).toHaveAccessibleName(en.centralAdmin.scope);
    expect(selector()).toHaveValue('ANS');
  });

  it('keeps only authorized workspace landing links in the global rail and marks the current one', () => {
    view({ entries: { studio: '/studio', grading: null, admin: '/admin' } }, { rail: true });
    const rail = screen.getByRole('navigation', { name: 'Global navigation' });
    expect(within(rail).getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/studio');
    expect(within(rail).getByRole('link', { name: 'Studio' })).toHaveAttribute('aria-current', 'page');
    expect(within(rail).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(within(rail).getByRole('link', { name: 'Admin' })).not.toHaveAttribute('aria-current');
    expect(within(rail).queryByRole('link', { name: 'Teaching' })).not.toBeInTheDocument();
  });

  it('offers every authorized school in a native listbox with the active school selected', async () => {
    view();
    const list = await openSchools();
    expect(within(list).getAllByRole('option').map(school => school.textContent)).toEqual([en.centralAdmin.central, 'ANS', 'Dewey']);
    expect(within(list).getByRole('option', { name: 'ANS' })).toHaveAttribute('aria-selected', 'true');
    expect(within(list).queryByRole('link')).not.toBeInTheDocument();
  });

  it('retains school choices when Studio is the only authorized workspace', async () => {
    view({ entries: STUDIO_ONLY });
    const list = await openSchools();
    expect(within(list).getAllByRole('option')).toHaveLength(3);
    expect(within(list).queryByRole('option', { name: 'Studio' })).not.toBeInTheDocument();
  });

  it('renders the authorized school as a static labelled header when there is only one', () => {
    view({ entries: STUDIO_ONLY, scopeOptions: [options[1]] });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(en.centralAdmin.scope)).toBeInTheDocument();
    expect(screen.getByText('ANS')).toBeInTheDocument();
  });

  it('omits the school chooser without scope context while retaining authorized global destinations', () => {
    view({ entries: STUDIO_ONLY, scopeOptions: undefined, activeScope: undefined }, { rail: true });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const rail = screen.getByRole('navigation', { name: 'Global navigation' });
    expect(within(rail).getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/studio');
    expect(within(rail).queryByRole('link', { name: 'Teaching' })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('portals the native school list and applies the actual light and dark provider themes', async () => {
    const light = view();
    const lightList = await openSchools();
    expect(light.container.contains(lightList)).toBe(false);
    const lightBackground = background(lightList);
    light.unmount();
    const dark = view({}, { theme: 'dark' });
    const darkList = await openSchools();
    expect(dark.container.contains(darkList)).toBe(false);
    const darkBackground = background(darkList);
    expect(darkBackground).not.toBe(lightBackground);
    expect(brightness(darkBackground)).toBeLessThan(brightness(lightBackground));
  });

  it('persists the chosen school then replaces and refreshes the same workspace', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: { scope: 'branch:dewey' } }), { status: 200 }));
    vi.stubGlobal('fetch', request);
    view({ workspace: 'grading' });
    await userEvent.click(within(await openSchools()).getByRole('option', { name: 'Dewey' }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/grading'));
    expect(nav.refresh).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('/api/v1/grading/scope', expect.objectContaining({
      method: 'POST', signal: expect.any(AbortSignal), body: JSON.stringify({ scope: 'branch:dewey' }),
    }));
    expect(screen.getByRole('status')).toHaveTextContent(en.centralAdmin.switchingScope);
  });

  it('does nothing when the active school is chosen again', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    view();
    await userEvent.click(within(await openSchools()).getByRole('option', { name: 'ANS' }));
    await act(async () => {});
    expect(request).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it('keeps the school and performs no POST when the unsaved-changes guard cancels', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    const guard = vi.fn(async () => false);
    const unregister = registerNavigationGuard(guard);
    try {
      view();
      await userEvent.click(within(await openSchools()).getByRole('option', { name: 'Dewey' }));
      await waitFor(() => expect(guard).toHaveBeenCalledOnce());
      expect(request).not.toHaveBeenCalled();
      expect(nav.replace).not.toHaveBeenCalled();
      expect(nav.refresh).not.toHaveBeenCalled();
      expect(screen.queryByText(en.centralAdmin.switchingScope)).not.toBeInTheDocument();
      expect(selector()).toHaveValue('ANS');
      expect(selector()).toBeEnabled();
    } finally { unregister(); }
  });

  it('announces a rejected school without changing the selection or navigating', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    view({ workspace: 'admin' });
    await userEvent.click(within(await openSchools()).getByRole('option', { name: 'Dewey' }));
    const message = await screen.findByText(en.centralAdmin.scopeError);
    expect(message.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(screen.queryByText(en.centralAdmin.switchingScope)).not.toBeInTheDocument();
    expect(selector()).toHaveValue('ANS');
    expect(selector()).toBeEnabled();
  });
});
