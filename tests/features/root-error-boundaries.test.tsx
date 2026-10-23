// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import messages from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock('@/lib/observability', () => ({ reportError: mocks.reportError }));

import AppError from '@/app/error';
import GlobalError from '@/app/global-error';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('root error hooks', () => {
  it('reports an app error and keeps a working retry action', async () => {
    const error = Object.assign(new Error('render failed'), { digest: 'digest-1' });
    const reset = vi.fn();
    mocks.reportError.mockReturnValue('correlation-app-1');

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AppError error={error} reset={reset} />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(mocks.reportError).toHaveBeenCalledWith(error, {
      area: 'app', digest: 'digest-1',
    }));
    expect(await screen.findByText('Reference: correlation-app-1')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('reports a root-layout failure from the global boundary', async () => {
    const error = Object.assign(new Error('layout failed'), { digest: 'digest-2' });
    mocks.reportError.mockReturnValue('correlation-global-2');

    const view = render(<GlobalError error={error} reset={vi.fn()} />, {
      container: document,
    });

    await waitFor(() => expect(mocks.reportError).toHaveBeenCalledWith(error, {
      area: 'global', digest: 'digest-2',
    }));
    expect(view.getByRole('heading', { name: /Something went wrong/ })).toBeInTheDocument();
    expect(view.getByText(/If the problem continues.*Nếu sự cố tiếp diễn/)).toBeInTheDocument();
    expect(await view.findByText('Reference / Mã tham chiếu: correlation-global-2')).toBeInTheDocument();
  });
});
