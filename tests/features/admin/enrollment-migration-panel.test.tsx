// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';

import messages from '@/messages/en.json';
import { EnrollmentMigrationPanel } from '@/features/enrollment/EnrollmentMigrationPanel';
import { CanvasProvider } from '@/features/canvas/ui';

function data(value: unknown) {
  return new Response(JSON.stringify({ data: value }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('shows skipped learner identifiers and reasons after a migration completes', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => data({
    migrated: ['learner-1'],
    skipped: [{ userId: 'learner-2', reason: 'ITEM_NOT_IN_LATEST_VERSION' }],
  }));
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CanvasProvider theme="light"><EnrollmentMigrationPanel courses={[{ id: 'course-1', title: 'AI Foundations' }]} /></CanvasProvider>
    </NextIntlClientProvider>,
  );

  await user.click(screen.getByRole('combobox', { name: 'Course' }));
  await user.click(await screen.findByRole('option', { name: 'AI Foundations' }));
  await user.click(screen.getByRole('button', { name: 'Migrate enrollments' }));

  expect(await screen.findByText('learner-2 · ITEM_NOT_IN_LATEST_VERSION')).toBeInTheDocument();
  expect(screen.getByText('Completed learning content is missing from the latest version.')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/studio/courses/course-1/enrollments/migrate', { method: 'POST' });
});

it('starts only one migration for same-tick repeated submissions', async () => {
  let resolveMigration!: (response: Response) => void;
  const migration = new Promise<Response>((resolve) => { resolveMigration = resolve; });
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => migration);
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CanvasProvider theme="light"><EnrollmentMigrationPanel courses={[{ id: 'course-1', title: 'AI Foundations' }]} /></CanvasProvider>
    </NextIntlClientProvider>,
  );

  await user.click(screen.getByRole('combobox', { name: 'Course' }));
  await user.click(await screen.findByRole('option', { name: 'AI Foundations' }));
  const form = screen.getByRole('button', { name: 'Migrate enrollments' }).closest('form');
  expect(form).not.toBeNull();
  await act(async () => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/studio/courses/course-1/enrollments/migrate', { method: 'POST' });
  expect(screen.getByRole('combobox', { name: 'Course' })).toBeDisabled();
  await act(async () => { resolveMigration(data({ migrated: [], skipped: [] })); await migration; });
  expect(await screen.findByText('Migrated 0 learners; skipped 0.')).toBeInTheDocument();
});
