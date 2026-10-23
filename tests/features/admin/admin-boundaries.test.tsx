// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AdminError from '@/app/admin/error';
import AdminForbiddenPage from '@/app/admin/forbidden';
import AdminLoading from '@/app/admin/loading';
import en from '@/messages/en.json';
import viMessages from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';

const mocks = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: mocks.reportError }));

function Provider({ children, locale = 'en' }: { children: React.ReactNode; locale?: 'en' | 'vi' }) {
  return <NextIntlClientProvider locale={locale} messages={staffUiTestMessages(locale === 'en' ? en : viMessages, locale)}>{children}</NextIntlClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Administration route boundaries', () => {
  it('shows Administration access copy and a way back to learning', () => {
    render(<Provider><AdminForbiddenPage /></Provider>);

    expect(screen.getByRole('heading', { name: 'Administration access required' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to learning' })).toHaveAttribute('href', '/app');
    expect(screen.queryByText(/Studio access required/)).not.toBeInTheDocument();
  });

  it('uses the same Administration access state for nested 403 errors without logging them', () => {
    const error = Object.assign(new Error('Request failed'), {
      cause: Object.assign(new Error('Permission denied'), { status: 403 }),
    });
    render(<Provider><AdminError error={error} reset={vi.fn()} /></Provider>);

    expect(screen.getByRole('heading', { name: 'Administration access required' })).toBeInTheDocument();
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  it('shows an Administration retry state and reports unexpected errors under Admin', async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('database unavailable'), { digest: 'error-123' });
    render(<Provider><AdminError error={error} reset={reset} /></Provider>);

    expect(screen.getByRole('heading', { name: 'Administration could not be loaded' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.reportError).toHaveBeenCalledWith(error, { area: 'admin', digest: 'error-123' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('announces an Administration-specific loading state in Vietnamese', () => {
    render(<Provider locale="vi"><AdminLoading /></Provider>);

    expect(screen.getByRole('status')).toHaveTextContent('Đang tải trang quản trị…');
    expect(screen.getByRole('heading', { name: 'Quản trị' })).toBeInTheDocument();
  });
});
