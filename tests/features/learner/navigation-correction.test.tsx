// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import messages from '@/messages/en.json';
import { withBenchMessages } from '@/messages/bench';
import { registerNavigationGuard } from '@/lib/navigation-guard';

const mocks = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/content-engine/render', () => ({ registerAll: () => {}, LessonRenderer: () => null, AssignmentRenderer: () => null }));
vi.mock('@/features/exams/ui/ExamFlow', () => ({ ExamFlow: () => null }));
import { ItemPlayer } from '@/features/learner/ui/ItemPlayer';
import { FocusOutline } from '@/features/learner/ui/FocusOutline';
import { LearnerNavigationLink } from '@/features/learner/ui/LearnerNavigationLink';

const translated = { ...withBenchMessages(messages, 'en'), learner: { ...messages.learner, item: { ...messages.learner.item, leaveTitle: 'Leave this item?', stayOnItem: 'Stay on this item' } } };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); mocks.push.mockReset(); });

function fixture() {
  let succeeds = false;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(succeeds ? { data: {} } : { error: { message: 'offline' } }), { status: succeeds ? 200 : 503 })));
  render(<NextIntlClientProvider locale="en" messages={translated}>
    <FocusOutline courseId="course" itemId="one" modules={[{ id: 'm', title: 'Module', items: [{ id: 'two', title: 'Second item', status: 'available' }] }]} />
    <ItemPlayer courseId="course" itemId="one" locale="en" item={{ kind: 'lesson', id: 'one', title: 'One', blocks: [] }} activityState={{}} completionMode="view" completed={false} attemptsUsed={0} />
    <LearnerNavigationLink href="/third">Third item</LearnerNavigationLink>
  </NextIntlClientProvider>);
  return () => { succeeds = true; };
}

for (const decision of ['leave', 'retry', 'stay'] as const) {
  it(`resolves the exact pending outline destination on ${decision}`, async () => {
    const succeed = fixture();
    fireEvent.click(screen.getByRole('button', { name: messages.learner.item.markComplete }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: messages.learner.focus.outline }));
    fireEvent.click(screen.getByRole('link', { name: 'Second item' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave this item?' });
    expect(screen.queryByRole('dialog', { name: messages.learner.focus.outline })).toBeNull();
    expect(mocks.push).not.toHaveBeenCalled();
    if (decision === 'retry') succeed();
    fireEvent.click(within(dialog).getByRole('button', { name: decision === 'leave' ? messages.learner.item.leaveAnyway : decision === 'retry' ? messages.learner.item.retrySave : 'Stay on this item' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    if (decision === 'stay') expect(mocks.push).not.toHaveBeenCalled();
    else expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/app/courses/course/items/two');
  });
}

it('only the first of two links owns a coalesced navigation decision', async () => {
  let resolve!: (value: boolean) => void;
  const remove = registerNavigationGuard(() => new Promise<boolean>((done) => { resolve = done; }));
  try {
    render(<><LearnerNavigationLink href="/first">First</LearnerNavigationLink><LearnerNavigationLink href="/second">Second</LearnerNavigationLink></>);
    fireEvent.click(screen.getByText('First'));
    fireEvent.click(screen.getByText('Second'));
    await act(async () => { resolve(true); });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/first');
  } finally { remove(); }
});

it.each([{ download: '' }, { href: '//elsewhere.test/file' }, { href: 'https://elsewhere.test/file' }, { href: 'mailto:a@example.test' }, { target: '_blank' }])('preserves native link behavior for %j', async (props) => {
  render(<LearnerNavigationLink href="/file" {...props}>Native</LearnerNavigationLink>);
  const link = screen.getByText('Native');
  let prevented = false;
  const listener = (event: MouseEvent) => { prevented = event.defaultPrevented; event.preventDefault(); };
  document.addEventListener('click', listener);
  fireEvent.click(link);
  document.removeEventListener('click', listener);
  await act(async () => {});
  expect(prevented).toBe(false);
  expect(mocks.push).not.toHaveBeenCalled();
});

it('guards same-origin absolute URLs', async () => {
  const guard = vi.fn().mockResolvedValue(false);
  const remove = registerNavigationGuard(guard);
  try {
    render(<LearnerNavigationLink href={`${window.location.origin}/second`}>Second</LearnerNavigationLink>);
    fireEvent.click(screen.getByText('Second'));
    await waitFor(() => expect(guard).toHaveBeenCalledOnce());
    expect(mocks.push).not.toHaveBeenCalled();
  } finally { remove(); }
});

it('keeps a failed retry pending, supports Escape, and restores outline trigger focus', async () => {
  fixture();
  fireEvent.click(screen.getByRole('button', { name: messages.learner.item.markComplete }));
  await screen.findByRole('alert');
  const trigger = screen.getByRole('button', { name: messages.learner.focus.outline });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('link', { name: 'Second item' }));
  const dialog = await screen.findByRole('dialog', { name: 'Leave this item?' });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  fireEvent.click(within(dialog).getByRole('button', { name: messages.learner.item.retrySave }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: messages.learner.item.retrySave })).toBeEnabled());
  expect(mocks.push).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(trigger).toHaveFocus();
});

it('does not restore drawer focus after the destination takes heading focus', async () => {
  render(<NextIntlClientProvider locale="en" messages={translated}>
    <h1 tabIndex={-1}>Destination</h1>
    <FocusOutline courseId="course" itemId="one" modules={[{ id: 'm', title: 'Module', items: [{ id: 'two', title: 'Second item', status: 'available' }] }]} />
  </NextIntlClientProvider>);
  const heading = screen.getByRole('heading', { name: 'Destination' });
  mocks.push.mockImplementation(() => heading.focus());
  fireEvent.click(screen.getByRole('button', { name: messages.learner.focus.outline }));
  fireEvent.click(screen.getByRole('link', { name: 'Second item' }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledOnce());
  await act(async () => { await new Promise(requestAnimationFrame); });
  expect(heading).toHaveFocus();
});

it.each(['metaKey', 'ctrlKey', 'shiftKey', 'altKey'])('preserves %s clicks', async (modifier) => {
  render(<LearnerNavigationLink href="/file">Modified</LearnerNavigationLink>);
  const listener = (event: MouseEvent) => { expect(event.defaultPrevented).toBe(false); event.preventDefault(); };
  document.addEventListener('click', listener, { once: true });
  fireEvent.click(screen.getByText('Modified'), { [modifier]: true });
  await act(async () => {});
  expect(mocks.push).not.toHaveBeenCalled();
});

it('does not bypass a later registered guard after Leave anyway', async () => {
  fixture();
  const remove = registerNavigationGuard(async () => false);
  try {
    fireEvent.click(screen.getByRole('button', { name: messages.learner.item.markComplete }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('link', { name: 'Third item' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave this item?' });
    fireEvent.click(within(dialog).getByRole('button', { name: messages.learner.item.leaveAnyway }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Third item' })).toHaveFocus();
  } finally { remove(); }
});

it('cancels a pending decision on unmount and permits a new request', async () => {
  fixture();
  fireEvent.click(screen.getByRole('button', { name: messages.learner.item.markComplete }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('link', { name: 'Third item' }));
  await screen.findByRole('dialog', { name: 'Leave this item?' });
  await act(async () => cleanup());
  expect(mocks.push).not.toHaveBeenCalled();
  render(<LearnerNavigationLink href="/fresh">Fresh</LearnerNavigationLink>);
  fireEvent.click(screen.getByRole('link', { name: 'Fresh' }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/fresh'));
});
