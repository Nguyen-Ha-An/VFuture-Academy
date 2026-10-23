// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';

const mocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

import { NewCourseDialog } from '@/features/studio/ui/NewCourseDialog';

function renderDialog() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <NewCourseDialog />
    </NextIntlClientProvider>,
  );
}

describe('NewCourseDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(cleanup);

  it('reports a non-kebab id while the user types and prevents submission', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'New course' }));
    await user.type(screen.getByLabelText('Course ID'), 'Bad ID');

    expect(screen.getByText('Use lowercase letters, numbers, and hyphens, starting with a letter or number.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create course' })).toBeDisabled();
  });

  it('accepts a one-character id and omits an empty optional translation', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { course: { id: 'a' }, draft: {} } }), { status: 200 }));
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'New course' }));
    await user.type(screen.getByLabelText('Course ID'), 'a');
    await user.type(screen.getByLabelText('Vietnamese title'), 'Khoá học');
    await user.click(screen.getByRole('button', { name: 'Create course' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/studio/courses', expect.objectContaining({
      body: JSON.stringify({
        id: 'a',
        title: { vi: 'Khoá học' },
        languages: ['vi', 'en'],
        defaultLanguage: 'vi',
        pathway: 'core-future-skills',
        level: 'foundation',
      }),
    }));
  });

  it('requires a nonblank title in the selected default language', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'New course' }));
    await user.type(screen.getByLabelText('Course ID'), 'course');
    await user.type(screen.getByLabelText('Vietnamese title'), 'Khoá học');
    await user.selectOptions(screen.getByLabelText('Default language'), 'en');

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a title in the selected default language');
    expect(screen.getByRole('button', { name: 'Create course' })).toBeDisabled();
  });

  it('submits all selected manifest metadata in one atomic create request and opens the workspace', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { course: { id: 'future-thinking' }, draft: {} } }), { status: 200 }));
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'New course' }));
    await user.type(screen.getByLabelText('Course ID'), 'future-thinking');
    await user.type(screen.getByLabelText('Vietnamese title'), 'Tư duy tương lai');
    await user.type(screen.getByLabelText('English title'), 'Future thinking');
    await user.selectOptions(screen.getByLabelText('Default language'), 'en');
    await user.selectOptions(screen.getByLabelText('Pathway'), 'research-innovation');
    await user.selectOptions(screen.getByLabelText('Level'), 'specialization');
    await user.click(screen.getByRole('button', { name: 'Create course' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/studio/courses', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        id: 'future-thinking',
        title: { vi: 'Tư duy tương lai', en: 'Future thinking' },
        languages: ['vi', 'en'],
        defaultLanguage: 'en',
        pathway: 'research-innovation',
        level: 'specialization',
      }),
    }));
    expect(mocks.push).toHaveBeenCalledWith('/studio/courses/future-thinking');
  });
});
