// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: mocks.reportError }));

import StudioError from '@/app/studio/error';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Provider({ children }: { children: React.ReactNode }) {
  return <NextIntlClientProvider locale="en" messages={en}>{children}</NextIntlClientProvider>;
}

describe('Studio error boundary', () => {
  it('renders the bilingual forbidden view for an ApiError-like 403 payload', () => {
    const error = Object.assign(new Error('Permission denied'), { status: 403, code: 'FORBIDDEN' });

    render(<Provider><StudioError error={error} reset={vi.fn()} /></Provider>);

    expect(screen.getByRole('heading', { name: 'Studio access required' })).toBeInTheDocument();
    expect(screen.getByText('Bạn không có quyền truy cập Studio.')).toBeInTheDocument();
    expect(mocks.reportError).not.toHaveBeenCalled();
  });

  it('renders a generic retry view for unexpected errors', async () => {
    const reset = vi.fn();
    render(<Provider><StudioError error={new Error('database unavailable')} reset={reset} /></Provider>);

    expect(screen.getByRole('heading', { name: 'Studio could not be loaded' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'database unavailable' }),
      { area: 'studio', digest: undefined },
    ));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
