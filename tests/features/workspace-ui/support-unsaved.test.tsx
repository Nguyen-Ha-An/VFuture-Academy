// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestNavigation } from '@/lib/navigation-guard';
import { useSupportUnsaved } from '@/features/workspace-ui/support/useSupportUnsaved';

function Form({ dirty }: { dirty: boolean }) {
  useSupportUnsaved(dirty, 'Discard your changes?');
  // eslint-disable-next-line @next/next/no-html-link-for-pages -- Exercises native links as well as guarded router navigation.
  return <><a href="/app/resources">Resources</a><form action="/signout" method="post" aria-label="Sign out"><button>Sign out</button></form></>;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('supporting form unsaved changes', () => {
  it('blocks ordinary links and guarded shell navigation when the learner stays', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Form dirty />);
    expect(fireEvent.click(screen.getByRole('link', { name: 'Resources' }))).toBe(false);
    expect(await requestNavigation()).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('does not intercept a link opened in another tab', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Form dirty />);
    const link = screen.getByRole('link', { name: 'Resources' });
    // Cancel the browser default independently, to keep the test document in place.
    link.addEventListener('click', event => event.preventDefault());
    fireEvent.click(link, { ctrlKey: true });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('cancels supported same-document history traversal only when the learner stays', () => {
    const navigation = new EventTarget();
    vi.stubGlobal('navigation', navigation);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<Form dirty />);
    const traversal = () => Object.assign(new Event('navigate', { cancelable: true }), { navigationType: 'traverse', destination: { sameDocument: true } });
    const stay = traversal(); navigation.dispatchEvent(stay);
    expect(stay.defaultPrevented).toBe(true);
    const leave = traversal(); navigation.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('protects document exit and navigation forms but releases guards after saving', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const view = render(<Form dirty />);
    const exit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(exit);
    expect(exit.defaultPrevented).toBe(true);
    expect(fireEvent.submit(screen.getByRole('form', { name: 'Sign out' }))).toBe(false);
    view.rerender(<Form dirty={false} />);
    expect(await requestNavigation()).toBe(true);
    const cleanExit = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanExit);
    expect(cleanExit.defaultPrevented).toBe(false);
  });
});
