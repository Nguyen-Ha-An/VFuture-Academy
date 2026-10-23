// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import type { ContentListRow } from '@/features/studio/content-lists-data';
import { ContentListTable } from '@/features/studio/ui/content/ContentListTable';

const messages = staffUiTestMessages(en, 'en');

function renderTable(props: Parameters<typeof ContentListTable>[0]) {
  return render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><ContentListTable {...props} /></NextIntlClientProvider>);
}

const resources: ContentListRow[] = [
  { id: 'ai-guide', title: 'Hướng dẫn trí tuệ nhân tạo', status: 'published', type: 'guide', secondary: null, updatedAt: '2026-09-20T08:00:00Z' },
  { id: 'prompt-template', title: 'Prompt template', status: 'draft', type: 'template', secondary: null, updatedAt: '2026-09-19T08:00:00Z' },
  { id: 'untitled-note', title: null, status: 'archived', type: 'template', secondary: null, updatedAt: null },
];

describe('Studio content list table', () => {
  afterEach(cleanup);

  it('searches without diacritics, filters status and type, and states the total of a complete list', async () => {
    const user = userEvent.setup();
    renderTable({ kind: 'resource', rows: resources });

    expect(screen.getByRole('heading', { name: 'All resources' })).toBeInTheDocument();
    expect(screen.getByText('Showing 1–3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Untitled resource' })).toHaveAttribute('href', '/studio/resources/untitled-note');
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Published')).toHaveAttribute('data-tone', 'success');
    expect(table.getByText('Guide')).toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search by title or ID' }), 'tri tue{Enter}');
    expect(screen.getByRole('link', { name: 'Hướng dẫn trí tuệ nhân tạo' })).toHaveAttribute('href', '/studio/resources/ai-guide');
    expect(screen.queryByRole('link', { name: 'Prompt template' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1–1 of 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'template');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'draft');
    expect(screen.getByRole('link', { name: 'Prompt template' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Untitled resource' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'published');
    expect(screen.getByText('No items match these filters.')).toBeInTheDocument();
  });

  it('pages a full server page with links, says filters cover this page, and never claims a total', () => {
    const rows: ContentListRow[] = Array.from({ length: 50 }, (_, index) => ({
      id: `opportunity-${index + 1}`,
      title: `Opportunity ${index + 1}`,
      status: 'published',
      type: index % 2 ? 'hackathon' : 'workshop',
      secondary: 'Future Lab',
      updatedAt: '2026-09-20T08:00:00Z',
    }));
    renderTable({ kind: 'opportunity', rows, page: 2, hasMore: true });

    expect(screen.getByText('Search and filters apply to the items on this page.')).toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/studio/opportunities?page=3');
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/studio/opportunities');
    expect(screen.getAllByRole('row')).toHaveLength(51);
    expect(within(screen.getByRole('table')).getAllByText('Hackathon').length).toBe(25);
    expect(screen.getAllByText('Future Lab').length).toBe(50);
  });

  it('says a page past the end has no more items instead of calling the library empty', () => {
    renderTable({ kind: 'resource', rows: [], page: 2, hasMore: false });

    expect(screen.queryByRole('heading', { name: 'No resources yet.' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No more items on this page.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to page 1' })).toHaveAttribute('href', '/studio/resources');
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/studio/resources');
  });

  it('shows the empty state without a toolbar when nothing exists yet', () => {
    renderTable({ kind: 'resource', rows: [] });

    expect(screen.getByRole('heading', { name: 'No resources yet.' })).toBeInTheDocument();
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('names the row menu after the record and links Edit to the editor', async () => {
    const user = userEvent.setup();
    renderTable({ kind: 'resource', rows: resources.slice(0, 1) });

    const trigger = screen.getByRole('button', { name: 'Actions for Hướng dẫn trí tuệ nhân tạo' });
    await user.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toHaveAttribute('href', '/studio/resources/ai-guide');
    expect(screen.getByRole('menuitem', { name: 'Copy ID' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    // Wait for Radix's deferred focus restoration before jsdom teardown.
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
