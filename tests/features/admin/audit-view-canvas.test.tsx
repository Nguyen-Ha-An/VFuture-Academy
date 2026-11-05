// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { AuditView, type AuditViewProps } from '@/app/admin/audit/AuditView';

const props: AuditViewProps = {
  title: 'Audit', description: 'History', filters: { action: 'role', target: 'school', actor: 'actor-1' },
  familyOptions: [{ value: 'role', label: 'Roles' }, { value: 'user.', label: 'Users' }], rows: [],
  page: 1, hasMore: false, previousHref: null, nextHref: null,
  labels: { family: 'Action family', allFamilies: 'All', target: 'Target', targetPlaceholder: 'Find target', apply: 'Apply', clearFilters: 'Clear', listTitle: 'Events', time: 'Time', action: 'Action', actor: 'Actor', targetColumn: 'Target', system: 'System', pagination: 'Pages', emptyTitle: 'No events', emptyDescription: 'Empty' },
};
afterEach(cleanup);
describe('Canvas audit filters', () => {
  it('submits the chosen family and preserves target and actor', async () => {
    render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={staffUiTestMessages(en, 'en')}><AuditView {...props} /></NextIntlClientProvider>);
    const form = screen.getByRole('search');
    expect(new FormData(form as HTMLFormElement).get('action')).toBe('role');
    await userEvent.click(screen.getByRole('combobox', { name: 'Action family' }));
    await userEvent.click(screen.getByRole('option', { name: 'Users' }));
    const data = new FormData(form as HTMLFormElement);
    expect(data.get('action')).toBe('user.');
    expect(data.get('target')).toBe('school');
    expect(data.get('actor')).toBe('actor-1');
  });
});
