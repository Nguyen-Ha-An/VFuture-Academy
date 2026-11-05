// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasResponsive } from '@/features/canvas/ui';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('restores the original element breakpoint without remounting state and cleans every resize listener', () => {
  vi.useFakeTimers();
  let width = 844;
  let delivering = false;
  let registrationsDuringDelivery = 0;
  let updatesDuringDelivery = 0;
  const observers = new Set<MockObserver>();
  class MockObserver {
    element?: Element;
    constructor(readonly callback: ResizeObserverCallback) { observers.add(this); }
    observe(element: Element) { if (delivering) registrationsDuringDelivery++; this.element = element; }
    unobserve() { this.element = undefined; }
    disconnect() { observers.delete(this); }
  }
  vi.stubGlobal('ResizeObserver', MockObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 200, width, height: 200, toJSON: () => ({}) }));
  const resize = (next: number, settle = true) => act(() => {
    width = next;
    delivering = true;
    for (const observer of [...observers]) if (observer.element) observer.callback([{ target: observer.element, contentRect: { width, height: 200 } } as ResizeObserverEntry], observer as unknown as ResizeObserver);
    delivering = false;
    if (settle) vi.advanceTimersByTime(150);
  });
  class TrackedResponsive extends CanvasResponsive {
    override addMatchListener(...[query, update, match]: Parameters<CanvasResponsive['addMatchListener']>) {
      return super.addMatchListener(query, (...args) => { if (delivering) updatesDuringDelivery++; update(...args); }, match);
    }
  }
  function StatefulContent({ stacked }: { stacked: boolean }) {
    const [draft, setDraft] = useState('Initial draft');
    return <><output aria-label="Layout">{stacked ? 'stacked' : 'table'}</output><input aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} /></>;
  }
  const view = render(<TrackedResponsive query={{ narrow: { maxWidth: 599 }, wide: { minWidth: 600 } }}>{(_props, matches) => <StatefulContent stacked={Boolean(matches?.includes('narrow'))} />}</TrackedResponsive>);
  const input = screen.getByRole('textbox', { name: 'Draft' });
  fireEvent.change(input, { target: { value: 'Unsaved work' } });
  input.focus();
  expect(screen.getByLabelText('Layout')).toHaveTextContent('table');
  resize(390);
  expect(screen.getByLabelText('Layout')).toHaveTextContent('stacked');
  resize(844);
  expect(screen.getByLabelText('Layout')).toHaveTextContent('table');
  expect(registrationsDuringDelivery).toBe(0);
  expect(updatesDuringDelivery).toBe(0);
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
  expect(input).toHaveValue('Unsaved work');
  expect(input).toHaveFocus();
  // An old debounced narrow callback must not overwrite an immediate return.
  resize(390, false);
  resize(844);
  expect(screen.getByLabelText('Layout')).toHaveTextContent('table');
  // The frame uses the latest geometry, not the width that first requested it.
  resize(390, false);
  resize(844, false);
  resize(760);
  expect(screen.getByLabelText('Layout')).toHaveTextContent('table');
  resize(390);
  expect(screen.getByLabelText('Layout')).toHaveTextContent('stacked');
  resize(760);
  expect(screen.getByLabelText('Layout')).toHaveTextContent('table');
  expect(registrationsDuringDelivery).toBe(0);
  expect(updatesDuringDelivery).toBe(0);
  // Unmount with a renewal frame pending: it must not attach any new observer.
  resize(390, false);
  resize(760, false);
  view.unmount();
  expect(observers.size).toBe(0);
  act(() => vi.runOnlyPendingTimers());
  expect(observers.size).toBe(0);
});
