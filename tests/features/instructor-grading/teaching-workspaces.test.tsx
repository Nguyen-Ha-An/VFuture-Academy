// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
vi.mock('next/navigation', () => ({ useServerInsertedHTML: () => undefined, useRouter: () => ({ push: vi.fn() }) }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementsWorkspace } from '@/features/instructor-grading/AnnouncementsWorkspace';
import { CanvasProvider } from '@/features/canvas/ui';
import { ScheduleWorkspace } from '@/features/instructor-grading/ScheduleWorkspace';

const branches = [{ id: 'school-1', name: 'School One' }];
const options = { courses: [{ id: 'course-1', title: 'Physics' }], versions: [{ courseId: 'course-1', courseTitle: 'Physics', courseVersionId: 'version-1', version: 2 }] };
const response = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ data }) } as Response);
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('teaching workspaces', () => {
  it('saves a private draft then publishes it only on the explicit action', async () => {
    let published = false;
    let saved = false;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/teaching/options')) return response(options);
      if (url.includes('/publish')) { published = true; return response({}); }
      if (init?.method === 'POST') { saved = true; return response({}); }
      return response({ announcements: saved ? [{ id: 'a1', title: 'Welcome', body: 'Read chapter one', status: published ? 'published' : 'draft', revision: published ? 2 : 1 }] : [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { container } = render(<NextIntlClientProvider locale="en" messages={staffUiTestMessages(messages, "en")}><CanvasProvider><main><AnnouncementsWorkspace branches={branches} locale="en" /></main></CanvasProvider></NextIntlClientProvider>);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByLabelText('Course'));
    await user.click(await screen.findByRole('option', { name: 'Physics' }));
    await user.type(screen.getByLabelText('Title'), 'Welcome');
    await user.type(screen.getByLabelText('Message'), 'Read chapter one');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/publish'))).toBe(false);
    const create = fetchMock.mock.calls.find(([url, init]) => url === '/api/v1/teaching/announcements' && init?.method === 'POST');
    expect(JSON.parse(String(create?.[1]?.body))).toEqual({ branchId: 'school-1', courseId: 'course-1', title: 'Welcome', body: 'Read chapter one' });
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Published')).toBeInTheDocument();
    const publication = fetchMock.mock.calls.find(([url]) => url.includes('/publish'));
    expect(JSON.parse(String(publication?.[1]?.body))).toEqual({ expectedRevision: 1 });
  });

  it('loads school versions and saves an optional deadline in Vietnam time', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/teaching/options')) return response(options);
      if (init?.method === 'PUT') return response({});
      return response({ schedules: [], assignments: [{ itemId: 'exercise', blockId: null, title: 'First exercise' }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { container } = render(<NextIntlClientProvider locale="en" messages={staffUiTestMessages(messages, "en")}><CanvasProvider><main><ScheduleWorkspace branches={branches} locale="en" /></main></CanvasProvider></NextIntlClientProvider>);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await user.click(screen.getByLabelText('Course version'));
    await user.click(await screen.findByRole('option', { name: 'Physics · Version 2' }));
    expect(fetchMock.mock.calls.some(([url]) => url.includes('locale=en'))).toBe(true);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('/schedules?'))).toBe(true));
    await user.click(screen.getByLabelText('Assignment'));
    await user.click(await screen.findByRole('option', { name: 'First exercise' }));
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/schedules?') && url.includes('locale=en'))).toBe(true);
    await user.type(screen.getByLabelText('Deadline (optional)'), '2026-11-05T00:30');
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ branchId: 'school-1', courseVersionId: 'version-1', itemId: 'exercise', blockId: null, dueAt: '2026-11-04T17:30:00.000Z' });
    await user.clear(screen.getByLabelText('Deadline (optional)'));
    await user.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2));
    const clear = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')[1];
    expect(JSON.parse(String(clear[1]?.body)).dueAt).toBeNull();
  });
});
