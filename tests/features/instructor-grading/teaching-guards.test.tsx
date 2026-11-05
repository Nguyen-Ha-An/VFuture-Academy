// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { CanvasProvider } from '@/features/canvas/ui';
import { AnnouncementsWorkspace } from '@/features/instructor-grading/AnnouncementsWorkspace';
import { ScheduleWorkspace } from '@/features/instructor-grading/ScheduleWorkspace';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const branches = [{ id: 'school', name: 'School' }, { id: 'other', name: 'Other school' }];
const options = { courses: [{ id: 'course', title: 'Physics' }, { id: 'course2', title: 'Math' }], versions: [{ courseId: 'course', courseTitle: 'Physics', courseVersionId: 'v1', version: 1 }, { courseId: 'course2', courseTitle: 'Math', courseVersionId: 'v2', version: 2 }] };
const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ data }) } as Response);
const failed = () => Promise.resolve({ ok: false, status: 503, json: async () => ({ error: { code: 'OFFLINE' } }) } as Response);
function wrap(child: React.ReactNode) { return render(<NextIntlClientProvider locale="en" messages={staffUiTestMessages(en, 'en')}><CanvasProvider>{child}</CanvasProvider></NextIntlClientProvider>); }
async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) { await user.click(screen.getByLabelText(label)); await user.click(await screen.findByRole('option', { name: option })); }
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('teaching unsaved change guards', () => {
  it('retains a draft on New, course change, and edit until explicitly discarded', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/options') ? ok(options) : ok({ announcements: [{ id: 'a1', title: 'Saved announcement', body: 'Saved text', status: 'draft', revision: 3 }] })));
    const user = userEvent.setup(); wrap(<AnnouncementsWorkspace branches={branches} locale="en" />);
    await choose(user, 'School', 'School'); await choose(user, 'Course', 'Physics');
    await screen.findByText('Saved announcement');
    await user.type(screen.getByLabelText('Title'), 'My unsaved title');
    await user.type(screen.getByLabelText('Message'), 'My unsaved text');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    for (const trigger of [() => user.click(screen.getByRole('button', { name: 'New' })), () => choose(user, 'Course', 'Math'), () => choose(user, 'School', 'Other school'), () => user.click(screen.getByRole('button', { name: 'Edit draft' })), () => user.click(screen.getByRole('link', { name: /Teaching/ }))]) {
      await trigger();
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Stay' }));
      expect(screen.getByLabelText('Title')).toHaveValue('My unsaved title');
      expect(screen.getByLabelText('Message')).toHaveValue('My unsaved text');
    }
    await user.click(screen.getByRole('button', { name: 'New' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Discard/ }));
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue(''));
    expect(screen.getByRole('button', { name: 'Publish' })).toBeEnabled();
  });
  it('keeps edits after a stale revision and never silently retries a newer revision', async () => {
    let revision = 3;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/options')) return ok(options);
      if (init?.method === 'PATCH') return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: { code: 'STALE_ANNOUNCEMENT' } }) } as Response);
      return ok({ announcements: [{ id: 'a1', title: 'Saved announcement', body: 'Saved text', status: 'draft', revision }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup(); wrap(<AnnouncementsWorkspace branches={branches} locale="en" />);
    await choose(user, 'School', 'School'); await choose(user, 'Course', 'Physics');
    await user.click(await screen.findByRole('button', { name: 'Edit draft' }));
    await user.clear(screen.getByLabelText('Message')); await user.type(screen.getByLabelText('Message'), 'My changes');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Another operator changed');
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body)).expectedRevision).toBe(3);
    revision = 4;
    await user.click(screen.getByRole('button', { name: 'Refresh announcements' }));
    expect(screen.getByLabelText('Message')).toHaveValue('My changes');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1);
  });
  it('retains an edited deadline when saving from a context switch fails', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes('/options')) return ok(options);
      if (init?.method === 'PUT') return failed();
      return ok({ schedules: [], assignments: [{ itemId: 'one', blockId: null, title: 'First' }, { itemId: 'two', blockId: null, title: 'Second' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup(); wrap(<ScheduleWorkspace branches={branches} locale="en" />);
    await choose(user, 'School', 'School'); await choose(user, 'Course version', 'Physics · Version 1');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/schedules?'))).toBe(true));
    await choose(user, 'Assignment', 'First');
    await user.type(screen.getByLabelText('Deadline (optional)'), '2026-11-05T00:30');
    await choose(user, 'Assignment', 'Second');
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Deadline (optional)')).toHaveValue('2026-11-05T00:30');
    await user.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.getByLabelText('Assignment')).toHaveValue('First');
    await choose(user, 'Course version', 'Math · Version 2');
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stay' }));
    expect(screen.getByLabelText('Course version')).toHaveValue('Physics · Version 1');
    expect(screen.getByLabelText('Deadline (optional)')).toHaveValue('2026-11-05T00:30');
  });
});
