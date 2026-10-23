// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { CourseCta } from '@/features/learner/ui/CourseCta';
import { EnrollButton } from '@/features/learner/ui/EnrollButton';
import { AFTER_ENROLL_KEY } from '@/features/learner/ui/enroll-handoff';

const withIntl = (ui: ReactElement) => <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Ho_Chi_Minh">{ui}</NextIntlClientProvider>;
const cta = { href: '/app/courses/course-1/items/first', label: 'Continue learning' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('course CTA after enrolling', () => {
  it('moves focus to the new Continue CTA and announces "Enrolled" once the page refreshes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(201, { data: {} })));
    const user = userEvent.setup();
    const view = render(withIntl(<CourseCta courseId="course-1" enrolled={false} cta={null} />));

    await user.click(screen.getByRole('button', { name: 'Enroll' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(screen.getByRole('status')).toHaveTextContent('');

    // router.refresh() re-renders the server page with the enrolment.
    view.rerender(withIntl(<CourseCta courseId="course-1" enrolled cta={cta} />));

    const link = screen.getByRole('link', { name: 'Continue learning' });
    await waitFor(() => expect(link).toHaveFocus());
    expect(link).toHaveAttribute('href', cta.href);
    expect(link).toHaveClass('vf-btn', 'vf-btn-primary');
    expect(screen.getByRole('status')).toHaveTextContent('Enrolled');
    expect(sessionStorage.getItem(AFTER_ENROLL_KEY)).toBeNull();
  });

  it('hands focus off through sessionStorage when the refresh remounts the CTA', async () => {
    sessionStorage.setItem(AFTER_ENROLL_KEY, 'course-1');
    render(withIntl(<CourseCta courseId="course-1" enrolled cta={cta} />));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Continue learning' })).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Enrolled');
    expect(sessionStorage.getItem(AFTER_ENROLL_KEY)).toBeNull();
  });

  it('focuses the page h1 when the enrolled course has no items (no Continue link)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(201, { data: {} })));
    const user = userEvent.setup();
    const page = (enrolled: boolean) => withIntl(<article><h1>Empty course</h1><CourseCta courseId="course-1" enrolled={enrolled} cta={null} /></article>);
    const view = render(page(false));

    await user.click(screen.getByRole('button', { name: 'Enroll' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    view.rerender(page(true));

    const heading = screen.getByRole('heading', { level: 1, name: 'Empty course' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Enrolled');
  });

  it('focuses the status message when there is no Continue link and no h1', async () => {
    sessionStorage.setItem(AFTER_ENROLL_KEY, 'course-1');
    render(withIntl(<CourseCta courseId="course-1" enrolled cta={null} />));

    const status = screen.getByRole('status');
    await waitFor(() => expect(status).toHaveFocus());
    expect(status).toHaveAttribute('tabindex', '-1');
    expect(status).toHaveTextContent('Enrolled');
  });

  it('leaves focus alone on an ordinary visit to an enrolled course', () => {
    sessionStorage.setItem(AFTER_ENROLL_KEY, 'another-course');
    render(withIntl(<CourseCta courseId="course-1" enrolled cta={cta} />));

    expect(screen.getByRole('link', { name: 'Continue learning' })).not.toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(sessionStorage.getItem(AFTER_ENROLL_KEY)).toBe('another-course');
  });
});

describe('enrol button', () => {
  it('is one full-width vf-btn and links the missing prerequisites on PREREQ_MISSING', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(409, {
      error: { code: 'PREREQ_MISSING', issues: [{ path: ['prerequisites', 'ai-101'] }, { path: ['prerequisites', 'data-201'] }] },
    })));
    const user = userEvent.setup();
    render(withIntl(<EnrollButton courseId="course-1" prerequisites={[{ id: 'ai-101', label: 'AI-101' }, { id: 'data-201', label: 'Data basics' }, { id: 'done-100', label: 'DONE-100' }]} />));

    const button = screen.getByRole('button', { name: 'Enroll' });
    expect(button).toHaveClass('vf-btn', 'vf-btn-primary', 'vf-btn-block');
    await user.click(button);

    expect(await screen.findByRole('alert')).toHaveTextContent('Complete the required prerequisite courses first.');
    expect(screen.getByText('Needs')).toBeVisible();
    expect(screen.getByRole('link', { name: 'AI-101' })).toHaveAttribute('href', '/app/courses/ai-101');
    expect(screen.getByRole('link', { name: 'Data basics' })).toHaveAttribute('href', '/app/courses/data-201');
    // Only the prerequisites the server reports as missing are linked.
    expect(screen.queryByRole('link', { name: 'DONE-100' })).toBeNull();
    expect(button).toBeEnabled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
