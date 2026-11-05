// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileNavigationDrawer } from '@/components/ShellPrimitives';
import en from '@/messages/en.json';
import Link from 'next/link';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  { header: false, hidden: false, heading: true, target: 'heading' },
  { header: true, hidden: false, heading: true, target: 'header' },
  { header: true, hidden: true, heading: true, target: 'heading' },
  { header: false, hidden: false, heading: false, target: 'main' },
])('restores breakpoint focus in explicit priority order: $target (header=$header, hidden=$hidden)', async ({ header, hidden, heading, target }) => {
  let desktop: ((event: { matches: boolean }) => void) | undefined;
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: (_type: string, callback: typeof desktop) => { desktop = callback; }, removeEventListener: vi.fn() }));
  // jsdom has no layout; give visible elements geometry while retaining the real focus lifecycle.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 100, height: 30 }] as unknown as DOMRectList);
  function Shell() {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    return <NextIntlClientProvider locale="en" messages={en}>
      <button ref={trigger} onClick={() => setOpen(true)}>Open menu</button>
      {header && <header hidden={hidden}><Link data-testid="header" href="/app" aria-current="page">Dashboard</Link></header>}
      <main data-testid="main" tabIndex={-1}>{heading && <h1 data-testid="heading" tabIndex={-1}>Dashboard</h1>}</main>
      <MobileNavigationDrawer id="breakpoint-drawer" title="Navigation" open={open} onOpenChange={setOpen} returnFocusRef={trigger} closeAt="(min-width: 48rem)"><Link href="/app/courses">Courses</Link></MobileNavigationDrawer>
    </NextIntlClientProvider>;
  }
  render(<Shell />);
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  act(() => desktop?.({ matches: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId(target)).toHaveFocus());
});
