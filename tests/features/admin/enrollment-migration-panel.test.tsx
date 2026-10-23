// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';

import messages from '@/messages/en.json';
import { EnrollmentMigrationPanel } from '@/features/enrollment/EnrollmentMigrationPanel';

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
  vi.stubGlobal('fetch', vi.fn(async () => data({
    migrated: ['learner-1'],
    skipped: [{ userId: 'learner-2', reason: 'ITEM_NOT_IN_LATEST_VERSION' }],
  })));
  const user = userEvent.setup();

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <EnrollmentMigrationPanel courses={[{ id: 'course-1', title: 'AI Foundations' }]} />
    </NextIntlClientProvider>,
  );

  await user.selectOptions(screen.getByLabelText('Course'), 'course-1');
  await user.click(screen.getByRole('button', { name: 'Migrate enrollments' }));

  expect(await screen.findByText('learner-2 · ITEM_NOT_IN_LATEST_VERSION')).toBeInTheDocument();
});

it('starts only one migration for same-tick repeated submissions', async () => {
  let resolveMigration!: (response: Response) => void;
  const migration = new Promise<Response>((resolve) => { resolveMigration = resolve; });
  const fetchMock = vi.fn(async () => migration);
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();

  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <EnrollmentMigrationPanel courses={[{ id: 'course-1', title: 'AI Foundations' }]} />
    </NextIntlClientProvider>,
  );

  await user.selectOptions(screen.getByLabelText('Course'), 'course-1');
  const form = screen.getByRole('button', { name: 'Migrate enrollments' }).closest('form');
  expect(form).not.toBeNull();
  await act(async () => {
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  expect(fetchMock).toHaveBeenCalledTimes(1);
  resolveMigration(data({ migrated: [], skipped: [] }));
  expect(await screen.findByText('Migrated 0 learners; skipped 0.')).toBeInTheDocument();
});
