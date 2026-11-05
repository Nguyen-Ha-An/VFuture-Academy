// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
    await user.click(screen.getByRole('combobox', { name: 'Default language' }));
    await user.click(screen.getByRole('option', { name: en.studio.courses.language.en }));

    expect(screen.getByLabelText('English title')).toBeInvalid();
    expect(screen.getByLabelText('English title')).toHaveAccessibleDescription(en.studio.courses.defaultTitleRequired);
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
    await user.click(screen.getByRole('combobox', { name: 'Default language' }));
    await user.click(screen.getByRole('option', { name: en.studio.courses.language.en }));
    await user.click(screen.getByRole('combobox', { name: 'Pathway' }));
    await user.click(screen.getByRole('option', { name: en.studio.courses.pathwayOptions['research-innovation'] }));
    await user.click(screen.getByRole('combobox', { name: 'Level' }));
    await user.click(screen.getByRole('option', { name: en.studio.courses.levelOptions.specialization }));
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
  it('locks pending fields and retains the full create form after a duplicate response before a successful retry', async () => {
    const fetchMock = vi.mocked(fetch);
    let respond!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { respond = resolve; }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { course: { id: 'retry-course' }, draft: {} } }), { status: 200 }));
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'New course' }));
    await user.type(screen.getByLabelText('Course ID'), 'existing-course');
    await user.type(screen.getByLabelText('Vietnamese title'), 'Khóa học được giữ lại');
    await user.type(screen.getByLabelText('English title'), 'Retained course');
    await user.click(screen.getByRole('button', { name: 'Create course' }));
    expect(screen.getByLabelText('Course ID')).toBeDisabled();
    expect(screen.getByLabelText('English title')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => respond(new Response(JSON.stringify({ error: { code: 'COURSE_ID_CONFLICT', message: 'Course ID already exists.' } }), { status: 409 })));
    await waitFor(() => expect(screen.getByLabelText('Course ID')).toBeEnabled());
    expect(screen.getByText('Course ID already exists.')).toBeVisible();
    expect(screen.getByLabelText('Course ID')).toHaveValue('existing-course');
    expect(screen.getByLabelText('Vietnamese title')).toHaveValue('Khóa học được giữ lại');
    expect(screen.getByLabelText('English title')).toHaveValue('Retained course');
    await user.clear(screen.getByLabelText('Course ID'));
    await user.type(screen.getByLabelText('Course ID'), 'retry-course');
    await user.click(screen.getByRole('button', { name: 'Create course' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/studio/courses/retry-course'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/studio/courses', expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: 'retry-course', title: { vi: 'Khóa học được giữ lại', en: 'Retained course' }, languages: ['vi', 'en'], defaultLanguage: 'vi', pathway: 'core-future-skills', level: 'foundation' }) }));
  });

});
