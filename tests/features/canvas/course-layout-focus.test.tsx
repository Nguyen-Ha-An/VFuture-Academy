// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasCourseLayout } from '@/features/canvas/ui/CanvasCourseLayout';
import { CanvasProvider } from '@/features/canvas/ui/CanvasProvider';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('leaves desktop page focus alone and preserves learner state when navigation becomes a drawer', async () => {
  let matches = true;
  let change: (() => void) | undefined;
  vi.stubGlobal('matchMedia', (query: string) => ({ get matches() { return query.includes('1024px') && matches; }, addEventListener: (_event: string, listener: () => void) => { if (query.includes('1024px')) change = listener; }, removeEventListener: vi.fn() }));
  function Content() { const [count, setCount] = useState(0); return <button onClick={() => setCount(value => value + 1)}>Draft {count}</button>; }
  render(<NextIntlClientProvider locale="en" messages={{}}><CanvasProvider theme="light"><CanvasCourseLayout navigation={<nav aria-label="Course"><a href="#overview">Overview</a><a href="#modules">Modules</a></nav>}><h1 tabIndex={-1}>Modules</h1><Content /></CanvasCourseLayout></CanvasProvider></NextIntlClientProvider>);
  const heading = screen.getByRole('heading', { name: 'Modules' });
  heading.focus();
  await act(() => new Promise(resolve => setTimeout(resolve, 1250)));
  expect(heading).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Overview' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Draft 0' }));
  act(() => { matches = false; change?.(); });
  expect(screen.getByRole('button', { name: 'Draft 1' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
  act(() => { matches = true; change?.(); });
  expect(screen.getByRole('button', { name: 'Draft 1' })).toBeVisible();
});

it('dismisses an entering mobile drawer on Escape and returns focus after it exits', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(<NextIntlClientProvider locale="en" messages={{}}><CanvasProvider theme="light"><CanvasCourseLayout navigation={<nav aria-label="Course"><a href="#overview">Overview</a></nav>}><h1>Modules</h1></CanvasCourseLayout></CanvasProvider></NextIntlClientProvider>);
  const trigger = screen.getByRole('button', { name: 'Course navigation' });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole('navigation', { name: 'Course' })).toBeInTheDocument();
  // This is deliberately before waiting for the native enter transition/focus.
  fireEvent.keyDown(document.body, { key: 'Escape', keyCode: 27 });
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Course' })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  await userEvent.click(trigger);
  const close = screen.getByRole('button', { name: 'Close' });
  await waitFor(() => expect(close).toHaveFocus());
  fireEvent.keyDown(close, { key: 'Escape', keyCode: 27 });
  await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Course' })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('leaves Escape to a prevented event or expanded picker inside the mobile navigation', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  render(<NextIntlClientProvider locale="en" messages={{}}><CanvasProvider theme="light"><CanvasCourseLayout navigation={<nav aria-label="Course"><button onKeyDown={event => event.preventDefault()}>Nested action</button><input role="combobox" aria-label="Nested picker" aria-expanded="true" aria-controls="nested-options" /><div id="nested-options" /></nav>}><h1>Modules</h1></CanvasCourseLayout></CanvasProvider></NextIntlClientProvider>);
  const trigger = screen.getByRole('button', { name: 'Course navigation' });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Nested action' }), { key: 'Escape', keyCode: 27 });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Nested picker' }), { key: 'Escape', keyCode: 27 });
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Escape', keyCode: 27 });
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
});
