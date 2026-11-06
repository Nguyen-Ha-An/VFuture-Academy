// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({
  pathname: '/app',
  push: vi.fn(),
  requestNavigation: vi.fn<() => Promise<boolean>>(),
  dialogLoads: 0,
}));

const messages = { en: staffUiTestMessages(en, 'en'), vi: staffUiTestMessages(viMessages, 'vi') };

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  useServerInsertedHTML: () => undefined,
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async (namespace?: string) => createTranslator({ locale: 'en', messages: messages.en, namespace: namespace as never })),
}));
// Counts evaluations of the lazily imported palette module (cmdk lives only there).
vi.mock('@/features/workspace-ui/learner/command/LearnerCommandDialog', async importOriginal => {
  mocks.dialogLoads += 1;
  return importOriginal();
});

import { AppShell } from '@/components/AppShell';
import { registerNavigationGuard } from '@/lib/navigation-guard';
import { LearnerCommandMenu } from '@/features/workspace-ui/learner/command/LearnerCommandMenu';
import { AccountTray, useAccountTrayController } from '@/features/canvas/ui/AccountTray';
import { CanvasProvider } from '@/features/canvas/ui/CanvasProvider';
import ExplorePage from '@/app/app/explore/page';
import { learnerCommandEntries } from '@/features/workspace-ui/learner/command/entries';
import { applyWorkspaceTheme } from '@/features/workspace-ui/ui/ThemeSwitcher';

beforeAll(() => {
  // cmdk measures its list and scrolls the active item into view.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

let unregisterGuard: () => void = () => {};

beforeEach(() => {
  mocks.pathname = '/app';
  mocks.push.mockReset();
  mocks.requestNavigation.mockReset().mockResolvedValue(true);
  // Keep the production dispatcher real; this registered consumer controls Stay/Leave.
  unregisterGuard = registerNavigationGuard(mocks.requestNavigation);
  window.history.replaceState({}, '', '/app');
});

afterEach(() => {
  cleanup();
  unregisterGuard();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.cookie = 'vf-theme=; max-age=0; path=/';
});

const DESTINATIONS = { studioDestination: '/studio', gradingDestination: '/grading', adminDestination: '/admin' };

function renderShell({ locale = 'en', extra }: { locale?: 'en' | 'vi'; extra?: ReactNode } = {}) {
  return render(<NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Ho_Chi_Minh">
    <AppShell {...DESTINATIONS}><h1>Home</h1>{extra}</AppShell>
  </NextIntlClientProvider>);
}

// Real stateful command and account owners: closing the dialog is part of the contract.
function AccountHandoffHarness({ onHandoff }: { onHandoff: () => void }) {
  const account = useAccountTrayController();
  return <>
    <LearnerCommandMenu onOpenAccount={element => { onHandoff(); account.openFrom(element); }} />
    <AccountTray open={account.open} onOpenChange={account.setOpen} restoreFocus={account.restoreFocus}
      identity={{ name: 'Avery Nguyen', handle: 'avery' }} theme="system" />
  </>;
}

const trigger = () => screen.getByRole('button', { name: 'Search or jump to…', hidden: true });
const option = (name: string | RegExp) => screen.queryByRole('option', { name });

function pressShortcut(init: KeyboardEventInit = { metaKey: true }, target: Element | Window = document.activeElement ?? window) {
  act(() => { fireEvent.keyDown(target, { key: 'k', ...init }); });
}

async function openPalette(name = 'Command menu') {
  pressShortcut();
  return screen.findByRole('dialog', { name });
}

describe('learner command menu bundle boundary', () => {
  // First in the file: the palette module is evaluated at most once per run.
  it('loads the dialog module only on intent (pointer or focus on the trigger)', async () => {
    renderShell();
    expect(trigger()).toBeInTheDocument();
    expect(mocks.dialogLoads).toBe(0);
    fireEvent.pointerEnter(trigger());
    await waitFor(() => expect(mocks.dialogLoads).toBe(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps cmdk and the dialog out of the static import graph of the trigger', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(`${process.cwd()}/src/features/workspace-ui/learner/command/LearnerCommandMenu.tsx`, 'utf8');
    const staticImports = [...source.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map(match => match[1]);
    expect(staticImports).not.toContain('cmdk');
    expect(staticImports).not.toContain('@/components/ui/command');
    expect(staticImports).not.toContain('./LearnerCommandDialog');
    expect(source).toMatch(/import\(["']\.\/LearnerCommandDialog["']\)/);
  });
});

describe('learner command menu trigger and shortcut', () => {
  it('sits first in the Canvas header action slot with shortcut and aria-keyshortcuts', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const { container } = renderShell();
    const right = container.querySelector('.canvas-learner-header-actions')!;
    expect(right.firstElementChild).toBe(trigger());
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
    expect(trigger().querySelector('kbd')).toHaveTextContent('⌘K');
    expect(trigger().querySelector('kbd')).toHaveAttribute('aria-hidden', 'true');
    cleanup();
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    renderShell();
    expect(trigger()).toHaveAttribute('aria-keyshortcuts', 'Control+K');
    expect(trigger().querySelector('kbd')).toHaveTextContent('Ctrl K');
  });

  it('keeps the command menu available on focus routes', () => {
    mocks.pathname = '/app/courses/ai/items/lesson-1';
    renderShell();
    expect(screen.getByRole('button', { name: 'Search or jump to…' })).toBeInTheDocument();
  });

  it('opens with ⌘K and Ctrl K, and a second press closes it', async () => {
    renderShell();
    const dialog = await openPalette();
    expect(within(dialog).getByRole('combobox')).toHaveAttribute('placeholder', 'Type a page or action…');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    pressShortcut({ metaKey: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    pressShortcut({ ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command menu' })).toBeInTheDocument();
  });

  it('does not open while typing in a field, a contenteditable or a CodeMirror editor', () => {
    renderShell({ extra: <>
      <input aria-label="Name" />
      <textarea aria-label="Notes" />
      <div contentEditable suppressContentEditableWarning aria-label="Rich text">text</div>
      <div className="cm-editor"><div className="cm-content" tabIndex={0} aria-label="Code">code</div></div>
    </> });
    for (const target of [screen.getByRole('textbox', { name: 'Name' }), screen.getByRole('textbox', { name: 'Notes' }), screen.getByLabelText('Rich text'), screen.getByLabelText('Code')]) {
      target.focus();
      pressShortcut({ metaKey: true }, target);
      pressShortcut({ ctrlKey: true }, target);
    }
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not open over a modal that has focus', () => {
    renderShell({ extra: <div role="dialog" aria-label="Unsaved changes"><button type="button">Stay</button></div> });
    screen.getByRole('button', { name: 'Stay' }).focus();
    pressShortcut();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('returns focus to the trigger on Escape, also when ⌘K came from the page body', async () => {
    renderShell();
    trigger().focus();
    fireEvent.click(trigger());
    const dialog = await screen.findByRole('dialog', { name: 'Command menu' });
    fireEvent.keyDown(within(dialog).getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger()).toHaveFocus());

    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    const reopened = await openPalette();
    fireEvent.keyDown(within(reopened).getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger()).toHaveFocus());
  });
});

describe('learner command menu content', () => {
  it('groups Go to, Explore, Account, Workspaces and Preferences, with g-shortcut hints and a hint footer outside the listbox', async () => {
    renderShell();
    const dialog = await openPalette();
    expect([...dialog.querySelectorAll('[cmdk-group-heading]')].map(node => node.textContent)).toEqual(['Go to', 'Explore', 'Account', 'Workspaces', 'Preferences']);
    for (const name of ['Learning', 'Courses', 'Explore', 'Resources', 'Opportunities', 'Projects', 'Profile', 'Certificates', 'XP', 'Leaderboard', 'Open Studio', 'Open assessment & grading', 'Open administration', 'Light theme', 'Dark theme', 'Language and appearance']) {
      expect(option(name), name).toBeInTheDocument();
    }
    expect(option(/^Automatic theme\s*Current$/)).toBeInTheDocument();
    expect(option(/^English\s*Current$/)).not.toBeInTheDocument();
    expect(option('Tiếng Việt')).not.toBeInTheDocument();
    const learning = option('Learning')!;
    expect(learning).toHaveTextContent('A1');
    expect(learning).toHaveTextContent('g then 1');
    expect(option('Explore')).toHaveTextContent('g then 3');
    const listbox = within(dialog).getByRole('listbox');
    const hint = within(dialog).getByText('↑↓ to move · Enter to open · Esc to close');
    expect(listbox).not.toContainElement(hint);
    // "Propose a project" sits in Explore, after the three Explore destinations.
    const exploreGroup = [...dialog.querySelectorAll('[cmdk-group]')].find(group => group.querySelector('[cmdk-group-heading]')?.textContent === 'Explore')!;
    expect(within(exploreGroup as HTMLElement).getAllByRole('option').map(node => node.textContent)).toEqual(['Resources', 'Opportunities', 'Projects', 'Propose a project']);
  });

  it('opens the proposal route from "Propose a project" through the navigation guard', async () => {
    renderShell();
    await openPalette();
    fireEvent.click(option('Propose a project')!);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/app/projects/new'));
    expect(mocks.requestNavigation).toHaveBeenCalledTimes(1);
  });

  it('omits Workspaces without destinations', async () => {
    render(<NextIntlClientProvider locale="en" messages={messages.en} timeZone="Asia/Ho_Chi_Minh"><AppShell><h1>Home</h1></AppShell></NextIntlClientProvider>);
    const dialog = await openPalette();
    expect(within(dialog).queryByText('Workspaces')).not.toBeInTheDocument();
    expect(option('Open Studio')).not.toBeInTheDocument();
  });

  it('finds Vietnamese entries without diacritics and by their English label', async () => {
    renderShell({ locale: 'vi' });
    const dialog = await openPalette('Bảng lệnh');
    const input = within(dialog).getByRole('combobox');
    const courses = viMessages.learner.focus.courses; // "Khóa học"
    fireEvent.change(input, { target: { value: 'khoa hoc' } });
    await waitFor(() => expect(option(courses)).toBeInTheDocument());
    expect(option(viMessages.learner.focus.resources)).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Khoá học' } });
    await waitFor(() => expect(option(courses)).toBeInTheDocument());
    fireEvent.change(input, { target: { value: 'resources' } });
    await waitFor(() => expect(option(viMessages.learner.focus.resources)).toBeInTheDocument());
    fireEvent.change(input, { target: { value: 'giao dien toi' } });
    await waitFor(() => expect(option('Giao diện tối')).toBeInTheDocument());
    fireEvent.change(input, { target: { value: 'ngon ngu' } });
    await waitFor(() => expect(option('Ngôn ngữ và giao diện')).toBeInTheDocument());
    expect(option('Tiếng Việt')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'English' } });
    await waitFor(() => expect(option('Ngôn ngữ và giao diện')).toBeInTheDocument());
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(await within(dialog).findByText('Không có kết quả.')).toBeInTheDocument();
  });
});

describe('learner command menu actions', () => {
  it('exits the real dialog before asking the navigation guard, then pushes once', async () => {
    const dialogsAtGuard: Array<HTMLElement | null> = [];
    mocks.requestNavigation.mockImplementation(async () => {
      dialogsAtGuard.push(screen.queryByRole('dialog', { name: 'Command menu' }));
      return true;
    });
    renderShell();
    await openPalette();
    fireEvent.click(option('Resources')!);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/app/resources'));
    expect(mocks.requestNavigation).toHaveBeenCalledTimes(1);
    expect(dialogsAtGuard).toEqual([null]);
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.requestNavigation.mock.invocationCallOrder[0]).toBeLessThan(mocks.push.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('stays put when the guard refuses', async () => {
    const dialogsAtGuard: Array<HTMLElement | null> = [];
    mocks.requestNavigation.mockImplementation(async () => {
      dialogsAtGuard.push(screen.queryByRole('dialog', { name: 'Command menu' }));
      return false;
    });
    renderShell();
    await openPalette();
    fireEvent.click(option('Leaderboard')!);
    await waitFor(() => expect(mocks.requestNavigation).toHaveBeenCalled());
    await act(async () => {});
    expect(dialogsAtGuard).toEqual([null]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('moves to a same-page hash target without the guard', async () => {
    window.history.pushState({}, '', '/app/profile');
    mocks.pathname = '/app/profile';
    try {
      renderShell({ extra: <h2 id="certificates-heading" tabIndex={-1}>Certificates</h2> });
      await openPalette();
      fireEvent.click(option('Certificates')!);
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Certificates' })).toHaveFocus());
      expect(window.location.hash).toBe('#certificates-heading');
      expect(mocks.requestNavigation).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('applies a theme through the workspace theme helper without navigating', async () => {
    renderShell();
    await openPalette();
    fireEvent.click(option('Dark theme')!);
    expect(document.querySelector('.vf-workspace')).toHaveAttribute('data-theme', 'dark');
    expect(document.cookie).toContain('vf-theme=dark');
    expect(mocks.requestNavigation).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await openPalette();
    expect(option(/^Dark theme\s*Current$/)).toBeInTheDocument();
  });

  it('re-reads the theme on reopen after another control changed it', async () => {
    renderShell();
    await openPalette();
    pressShortcut();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    applyWorkspaceTheme('light');
    await openPalette();
    expect(option(/^Light theme\s*Current$/)).toBeInTheDocument();
    applyWorkspaceTheme('system');
  });

  it('hands language preferences to the single shared Account owner without a locale mutation', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderShell();
    const dialog = await openPalette();
    expect(within(dialog).queryByRole('option', { name: 'Tiếng Việt' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('option', { name: 'Language and appearance' }));
    const account = await screen.findByRole('dialog', { name: 'Account' });
    expect(screen.queryByRole('dialog', { name: 'Command menu' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog', { name: 'Account' })).toHaveLength(1);
    expect(within(account).getAllByRole('combobox')).toHaveLength(2);
    expect(within(account).getByRole('combobox', { name: en.common.language })).toHaveValue(en.locale.en);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.requestNavigation).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('calls the Account handoff only after the actual command dialog has exited', async () => {
    const onHandoff = vi.fn(() => {
      expect(screen.queryByRole('dialog', { name: 'Command menu' })).not.toBeInTheDocument();
    });
    render(<NextIntlClientProvider locale="en" messages={messages.en}><CanvasProvider theme="system">
      <div className="vf-workspace vf-learner-refined"><AccountHandoffHarness onHandoff={onHandoff} /></div>
    </CanvasProvider></NextIntlClientProvider>);
    const dialog = await openPalette();
    fireEvent.click(within(dialog).getByRole('option', { name: 'Language and appearance' }));
    await screen.findByRole('dialog', { name: 'Account' });
    expect(onHandoff).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('ignores an old route approval after the command menu reopens', async () => {
    let finish: ((allowed: boolean) => void) | undefined;
    mocks.requestNavigation.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    renderShell();
    try {
      await openPalette();
      fireEvent.click(option('Resources')!);
      await waitFor(() => expect(mocks.requestNavigation).toHaveBeenCalledOnce());
      await openPalette();
      await act(async () => { finish?.(true); });
      expect(screen.getByRole('dialog', { name: 'Command menu' })).toBeInTheDocument();
      expect(mocks.push).not.toHaveBeenCalled();
    } finally { await act(async () => { finish?.(false); }); }
  });

});

describe('learner command entries', () => {
  const t = (namespace: string) => createTranslator({ locale: 'en', messages: messages.en, namespace: namespace as never }) as unknown as (key: string) => string;
  const entries = learnerCommandEntries({ focus: t('learner.focus'), common: t('common'), command: t('bench.learner.command'), keywords: t('bench.learner.command.keywords') }, { studio: '/studio', grading: '/grading', admin: '/admin' });
  const hrefs = (group: string) => entries.filter(entry => entry.group === group).map(entry => entry.href);

  it('retains the three keyboard destinations as a subset of global navigation', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Global navigation' });
    const destinations = within(nav).getAllByRole('link').map(link => link.getAttribute('href'));
    expect(destinations).toEqual(expect.arrayContaining(hrefs('goTo').filter(href => href !== '/app/courses')));
    expect(within(nav).getByRole('button', { name: 'Courses' })).toHaveAttribute('aria-haspopup', 'dialog');
    expect(hrefs('goTo')).toContain('/app/courses');
    expect(entries.filter(entry => entry.group === 'goTo').map(entry => [entry.code, entry.shortcutKey])).toEqual([['A1', '1'], ['A2', '2'], ['A3', '3']]);
  });

  it('keeps account links in the tray, workspace destinations on the rail and XP in command search', async () => {
    renderShell();
    const rail = screen.getByRole('navigation', { name: 'Global navigation' });
    const railHrefs = within(rail).getAllByRole('link').map(link => link.getAttribute('href'));
    expect(railHrefs).toEqual(expect.arrayContaining(hrefs('workspaces')));
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    const tray = await screen.findByRole('dialog', { name: 'Account' });
    const links = within(tray).getAllByRole('link').map(link => link.getAttribute('href'));
    expect(links).toEqual(['/app/profile', '/app/profile#profile-settings-heading', '/app/profile#certificates-heading', '/app/leaderboard']);
    expect(links.filter(href => href !== '/app/profile#profile-settings-heading')).toEqual(hrefs('account').filter(href => href !== '/app/profile#xp-heading'));
    for (const href of hrefs('workspaces')) expect(links).not.toContain(href);
    expect(within(tray).queryByRole('link', { name: 'XP' })).not.toBeInTheDocument();
    expect(entries.find(entry => entry.id === 'account:xp')).toMatchObject({ group: 'account', href: '/app/profile#xp-heading', label: 'XP' });
  });

  it('uses the explore page hrefs for Explore', async () => {
    const page = await ExplorePage() as ReactElement<{ destinations: { href: string }[] }>;
    const explore = page.props.destinations.map(destination => destination.href);
    expect(hrefs('explore')).toEqual([...explore.filter(href => !href.startsWith('/app/courses')), '/app/projects/new']);
  });

  it('offers "Propose a project" in Explore, pointing at the proposal route', () => {
    expect(entries.find(entry => entry.id === 'explore:propose')).toMatchObject({ group: 'explore', href: '/app/projects/new', label: 'Propose a project' });
  });

  it('carries the other locale label in the keywords', () => {
    expect(entries.find(entry => entry.id === 'goTo:courses')?.keywords).toContain('Khoá học');
    expect(entries.find(entry => entry.id === 'explore:resources')?.keywords).toContain('Tài nguyên');
  });
});
