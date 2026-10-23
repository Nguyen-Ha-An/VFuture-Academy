// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import type { CourseRow } from '@/features/studio/courses-data';
import { CoursesView } from '@/features/studio/ui/CoursesView';

const messages = staffUiTestMessages(en, 'en');

const rows: CourseRow[] = [
  { id: 'python-basics', status: 'draft', reviewStatus: 'pending', stage: 'in_review', title: 'Python cơ bản', version: null, updatedAt: '2026-09-20T08:00:00Z', owner: 'Nguyễn Minh Anh' },
  { id: 'ai-foundations', status: 'published', reviewStatus: 'published', stage: 'published', title: 'Nền tảng trí tuệ nhân tạo', version: 3, updatedAt: '2026-09-18T08:00:00Z', owner: 'Trần Lan' },
  { id: 'minimal', status: 'draft', reviewStatus: null, stage: 'draft', title: null, version: null, updatedAt: '2026-09-22T08:00:00Z', owner: null },
];

function renderView(props: Partial<Parameters<typeof CoursesView>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <CoursesView rows={rows} reviews="ready" {...props} />
    </NextIntlClientProvider>,
  );
}

const titles = () => within(screen.getByRole('table')).getAllByRole('link').map((link) => link.textContent);

describe('Studio courses view', () => {
  afterEach(cleanup);

  it('shows snapshot KPIs by stage, the honest total and lifecycle badges', () => {
    renderView();

    expect(screen.getByRole('heading', { level: 1, name: 'Courses' })).toBeInTheDocument();
    const kpis = within(screen.getByLabelText('Course metrics'));
    expect(kpis.getByText('Courses')).toBeInTheDocument();
    expect(kpis.getByText('Waiting for review')).toBeInTheDocument();
    expect(screen.getByText('Showing 1–3 of 3')).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByText('In review')).toHaveAttribute('data-tone', 'warning');
    expect(table.getByText('Published')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByRole('link', { name: 'Untitled course' })).toHaveAttribute('href', '/studio/courses/minimal');
    // Newest first by default.
    expect(titles()).toEqual(['Untitled course', 'Python cơ bản', 'Nền tảng trí tuệ nhân tạo']);
    expect(screen.queryByRole('button', { name: 'New course' })).not.toBeInTheDocument();
  });

  it('filters by review-aware status, searches without diacritics and sorts by title', async () => {
    const user = userEvent.setup();
    renderView();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'in_review');
    expect(titles()).toEqual(['Python cơ bản']);
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search by course title or ID' }), 'tri tue{Enter}');
    expect(titles()).toEqual(['Nền tảng trí tuệ nhân tạo']);

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.click(screen.getByRole('button', { name: 'Title' }));
    expect(screen.getByRole('columnheader', { name: 'Title' })).toHaveAttribute('aria-sort', 'ascending');
    expect(titles()).toEqual(['Nền tảng trí tuệ nhân tạo', 'Python cơ bản', 'Untitled course']);
    expect(screen.getByRole('columnheader', { name: 'Updated' })).toHaveAttribute('aria-sort', 'none');
  });

  it('says review states are unavailable instead of guessing stages', () => {
    renderView({
      reviews: 'unavailable',
      rows: rows.map((row) => ({ ...row, reviewStatus: null, stage: row.status })),
    });

    expect(screen.getByText(/Review states could not be loaded/)).toBeInTheDocument();
    const kpis = within(screen.getByLabelText('Course metrics'));
    expect(kpis.getAllByText('Unavailable')).toHaveLength(3);
    const statusOptions = within(screen.getByRole('combobox', { name: 'Status' })).getAllByRole('option').map((option) => option.textContent);
    expect(statusOptions).not.toContain('In review');
  });

  it('shows the empty state without KPIs when there are no courses', () => {
    renderView({ rows: [] });

    expect(screen.getByText('No courses yet. Create the first course to begin.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Course metrics')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
