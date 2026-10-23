// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import vi_ from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import type { UploadedCover } from '@/features/projects/ui/cover-upload';
import { parseOutputLinks } from '@/features/projects/ui/form-utils';
import { projectProposalOptions } from '@/features/projects/ui/project-bench-model';
import { ProjectInterestButton } from '@/features/projects/ui/ProjectInterestButton';
import { ProjectProposalForm } from '@/features/projects/ui/ProjectProposalForm';
import { ProposalSubmittedNotice } from '@/features/projects/ui/ProposalSubmittedNotice';
import { StudioProjectForm } from '@/features/projects/ui/StudioProjectForm';

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() },
  upload: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
}));
vi.mock('@/features/projects/ui/cover-upload', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/projects/ui/cover-upload')>(),
  uploadProjectCover: mocks.upload,
}));

function Provider({ children, locale = 'en' }: { children: React.ReactNode; locale?: 'en' | 'vi' }) {
  return <NextIntlClientProvider locale={locale} timeZone="UTC" messages={staffUiTestMessages(locale === 'vi' ? vi_ : en, locale)}>{children}</NextIntlClientProvider>;
}

const jsonResponse = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), {
  status,
  headers: { 'content-type': 'application/json' },
});
const errorResponse = (status: number, code: string, message: string) => new Response(JSON.stringify({ error: { code, message } }), {
  status,
  headers: { 'content-type': 'application/json' },
});

const skillOptions = [
  { id: 'climate-science', label: 'Khí hậu học' },
  { id: 'data-literacy', label: 'Data literacy' },
  { id: 'prototyping', label: 'Prototyping' },
];
const courseOptions = [
  { id: 'ai-foundations', label: 'AI Foundations' },
  { id: 'product-lab', label: 'Product lab' },
];

function renderForm(locale: 'en' | 'vi' = 'en') {
  return render(<Provider locale={locale}><ProjectProposalForm locale={locale} skillOptions={skillOptions} courseOptions={courseOptions} /></Provider>);
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const [url, request] = fetchMock.mock.calls[call] as [string, RequestInit];
  expect(url).toBe('/api/v1/projects');
  return JSON.parse(String(request.body)) as Record<string, unknown>;
}

async function fillIdea(user: ReturnType<typeof userEvent.setup>, title = 'Climate lab', summary = 'Community climate data.') {
  await user.type(screen.getByRole('textbox', { name: 'Title' }), title);
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), summary);
}

beforeAll(() => {
  // Radix Popover and cmdk measure and scroll; jsdom has neither.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

beforeEach(() => {
  mocks.upload.mockReset();
  // jsdom has no object URLs; the form previews the local file through one.
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:cover-preview'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('project proposal form', () => {
  it('sends only the current language, derives the link from the title and redirects to the submitted project', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'climate-lab', approved: false }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm('en');

    expect(screen.getAllByText('Written in English')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeRequired();
    expect(screen.getByRole('textbox', { name: 'Summary' })).toBeRequired();
    // Only the current language is required (F5): the other-language title is optional and folded away.
    const otherTitle = screen.getByRole('textbox', { name: 'Title in Vietnamese', hidden: true });
    expect(otherTitle).not.toBeRequired();
    const disclosure = otherTitle.closest('details');
    expect(disclosure).toHaveClass('vf-proposal-disclosure');
    expect(disclosure).not.toHaveAttribute('open');
    await fillIdea(user);
    expect(screen.getByText('Your project page will be at /app/projects/climate-lab')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Submit proposal' }));

    const body = sentBody(fetchMock);
    expect(body).toEqual({
      id: 'climate-lab',
      title: { en: 'Climate lab' },
      summary: { en: 'Community climate data.' },
      outputLinks: [],
      skills: [],
      courseIds: [],
      coverAssetId: null,
      members: [],
    });
    expect(body).not.toHaveProperty('approved');
    expect(body).not.toHaveProperty('status');
    expect(mocks.router.push).toHaveBeenCalledWith('/app/projects/climate-lab?submitted=1');
  });

  it('sends Vietnamese only in vi, and adds the optional English version only when it is filled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'phong-lab-khi-hau' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm('vi');

    expect(screen.getAllByText('Viết bằng tiếng Việt')).toHaveLength(1);
    await user.type(screen.getByRole('textbox', { name: 'Tên dự án' }), 'Phòng lab khí hậu');
    await user.type(screen.getByRole('textbox', { name: 'Tóm tắt' }), 'Dữ liệu khí hậu.');
    const disclosure = screen.getByText('Thêm bản tiếng Anh (tuỳ chọn)').closest('details');
    expect(disclosure?.open).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Gửi đề xuất' }));
    expect(sentBody(fetchMock)).toMatchObject({
      id: 'phong-lab-khi-hau',
      title: { vi: 'Phòng lab khí hậu' },
      summary: { vi: 'Dữ liệu khí hậu.' },
    });
    expect(sentBody(fetchMock).title).not.toHaveProperty('en');

    cleanup();

    renderForm('vi');
    await user.type(screen.getByRole('textbox', { name: 'Tên dự án' }), 'Phòng lab khí hậu');
    await user.type(screen.getByRole('textbox', { name: 'Tóm tắt' }), 'Dữ liệu khí hậu.');
    await user.click(screen.getByText('Thêm bản tiếng Anh (tuỳ chọn)'));
    expect(screen.getByText('Thêm bản tiếng Anh (tuỳ chọn)').closest('details')?.open).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Tên dự án bằng tiếng Anh' }), 'Climate lab');
    await user.click(screen.getByRole('button', { name: 'Gửi đề xuất' }));
    const second = sentBody(fetchMock, 1);
    expect(second.title).toEqual({ vi: 'Phòng lab khí hậu', en: 'Climate lab' });
    // An empty English summary is not sent.
    expect(second.summary).toEqual({ vi: 'Dữ liệu khí hậu.' });
  });

  it('avoids reserved links and lets the learner change the link', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'my-lab' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm('en');

    await fillIdea(user, 'New');
    expect(screen.getByText('Your project page will be at /app/projects/new-project')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Project link' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change link' }));
    const link = screen.getByRole('textbox', { name: 'Project link' });
    expect(link).toHaveValue('new-project');
    await user.clear(link);
    await user.type(link, 'my-lab');
    await user.click(screen.getByRole('button', { name: 'Submit proposal' }));

    expect(sentBody(fetchMock).id).toBe('my-lab');
    expect(mocks.router.push).toHaveBeenCalledWith('/app/projects/my-lab?submitted=1');
  });

  it('shows a taken link inline with a suggestion instead of redirecting', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(409, 'PROJECT_EXISTS', 'A project with this id already exists'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm('en');

    await fillIdea(user);
    await user.click(screen.getByRole('button', { name: 'Submit proposal' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This link is taken. Try climate-lab-2.');
    const link = screen.getByRole('textbox', { name: 'Project link' });
    expect(link).toHaveValue('climate-lab');
    expect(link).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(link).toHaveFocus());
    expect(mocks.router.push).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Climate lab');
  });

  it('keeps an in-flight proposal visible and announces a failed submission without clearing input', async () => {
    let rejectRequest: ((error: Error) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectRequest = reject; })));
    const user = userEvent.setup();
    renderForm('en');

    await fillIdea(user, 'Climate project', 'Project summary');
    await user.click(screen.getByRole('button', { name: 'Submit proposal' }));

    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    await act(async () => { rejectRequest?.(new Error('Network unavailable')); });
    // A network failure shows the localized message, never the raw error text.
    expect(await screen.findByRole('alert')).toHaveTextContent('The proposal could not be submitted.');
    expect(screen.queryByText(/Network unavailable/)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Climate project');
    expect(screen.getByRole('button', { name: 'Submit proposal' })).toBeEnabled();
  });

  it.each([
    [400, 'VALIDATION_FAILED', 'title.en: String must contain at least 1 character(s)'],
    [403, 'FORBIDDEN', 'Forbidden'],
    [409, 'CONFLICT', 'Something else conflicted'],
    [500, 'INTERNAL', 'Internal server error'],
  ])('maps a %i %s failure to the localized error instead of the server text', async (status, code, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(status, code, message)));
    const user = userEvent.setup();
    renderForm('vi');

    await user.type(screen.getByRole('textbox', { name: 'Tên dự án' }), 'Phòng lab');
    await user.type(screen.getByRole('textbox', { name: 'Tóm tắt' }), 'Dữ liệu khí hậu.');
    await user.click(screen.getByRole('button', { name: vi_.build.proposal.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(vi_.build.proposal.error);
    expect(screen.queryByText(message)).toBeNull();
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it('trims the title and summary before submitting', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'climate-lab' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm('en');

    await fillIdea(user, '   Climate lab  ', '  Community climate data.   ');
    await user.click(screen.getByRole('button', { name: 'Submit proposal' }));

    const body = sentBody(fetchMock);
    expect(body).toMatchObject({ id: 'climate-lab', title: { en: 'Climate lab' }, summary: { en: 'Community climate data.' } });
  });

  it('shows a localized field error for a whitespace-only title or summary and does not submit', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm('vi');

    const title = screen.getByRole('textbox', { name: 'Tên dự án' });
    const summary = screen.getByRole('textbox', { name: 'Tóm tắt' });
    await user.type(title, '   ');
    await user.type(summary, '  ');
    await user.click(screen.getByRole('button', { name: vi_.build.proposal.submit }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription(expect.stringContaining('Nhập tên dự án.'));
    expect(summary).toHaveAttribute('aria-invalid', 'true');
    expect(summary).toHaveAccessibleDescription(expect.stringContaining('Nhập tóm tắt.'));
    await waitFor(() => expect(title).toHaveFocus());

    // Typing clears that field's error; the other stays until it is fixed.
    await user.type(title, 'Phòng lab');
    expect(title).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText('Nhập tên dự án.')).toBeNull();
    await user.click(screen.getByRole('button', { name: vi_.build.proposal.submit }));
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(summary).toHaveFocus());
    expect(screen.getByText('Nhập tóm tắt.')).toBeVisible();
  });

  it('picks skills and courses from a keyboard-operable, diacritic-insensitive combobox', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'climate-lab' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm('en');
    await fillIdea(user);

    const skills = screen.getByRole('button', { name: 'Skills' });
    skills.focus();
    await user.keyboard('{Enter}');
    const search = await screen.findByRole('combobox', { name: 'Search skills' });
    await waitFor(() => expect(search).toHaveFocus());
    await user.keyboard('khi hau');
    const list = screen.getByRole('listbox', { name: 'Skills' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(1));
    expect(within(list).getByRole('option', { name: 'Khí hậu học' })).toBeDefined();
    await user.keyboard('{Enter}');
    // The chosen state is text, independent of cmdk's highlight (aria-selected).
    expect(within(list).getByRole('option', { name: 'Khí hậu học, selected' })).not.toHaveAttribute('aria-checked');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Skills' })).toBeNull());
    expect(skills).toHaveFocus();
    expect(within(screen.getByRole('list', { name: 'Skills' })).getByText('Khí hậu học')).toHaveClass('min-w-0');
    expect(screen.getByText('Khí hậu học').closest('li')).toHaveClass('vf-tag');

    await user.click(screen.getByRole('button', { name: 'Related courses' }));
    await user.keyboard('product');
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');

    // Chips remove by name.
    await user.click(screen.getByRole('button', { name: 'Skills' }));
    await user.keyboard('data');
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Remove Data literacy' }));
    expect(screen.queryByRole('button', { name: 'Remove Data literacy' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Skills' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Submit proposal' }));
    expect(sentBody(fetchMock)).toMatchObject({ skills: ['climate-science'], courseIds: ['product-lab'] });
  });

  it('adds https link rows with a hostname default label, removes them and caps them at 20', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'climate-lab' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderForm('en');
    await fillIdea(user);

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    const url = screen.getByRole('textbox', { name: 'URL for link 1' });
    await user.type(url, 'http://insecure.example.com');
    await user.tab();
    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(url).toHaveAccessibleDescription('Use a full https:// address.');
    await user.click(screen.getByRole('button', { name: 'Submit proposal' }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(url);
    await user.type(url, 'https://www.demo.example.com/app');
    await user.tab();
    expect(url).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('textbox', { name: 'Label for link 1' })).toHaveValue('demo.example.com');

    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByRole('textbox', { name: 'Label for link 2' }), 'Repository');
    await user.type(screen.getByRole('textbox', { name: 'URL for link 2' }), 'https://git.example.com/lab');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.click(screen.getByRole('button', { name: 'Remove link 3' }));
    expect(screen.queryByRole('textbox', { name: 'URL for link 3' })).toBeNull();
    // Focus falls back to the previous row rather than the document body.
    expect(screen.getByRole('textbox', { name: 'Label for link 2' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Submit proposal' }));
    expect(sentBody(fetchMock).outputLinks).toEqual([
      { label: { en: 'demo.example.com' }, url: 'https://www.demo.example.com/app' },
      { label: { en: 'Repository' }, url: 'https://git.example.com/lab' },
    ]);

    for (let count = 2; count < 20; count += 1) await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getAllByRole('textbox', { name: /^URL for link/ })).toHaveLength(20);
    expect(screen.getByRole('button', { name: 'Add link' })).toBeDisabled();
    expect(screen.getByText('You can add up to 20 links.')).toBeVisible();
  });

  it('uploads a cover with progress, previews it at 16:9 and removes it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'climate-lab' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    let finish: ((cover: UploadedCover) => void) | undefined;
    let progress: ((percent: number) => void) | undefined;
    mocks.upload.mockImplementation((_file: File, options: { onProgress?: (percent: number) => void }) => {
      progress = options.onProgress;
      return new Promise<UploadedCover>((resolve) => { finish = resolve; });
    });
    // applyAccept off: the browser picker filters by `accept`, but a drop or paste may not.
    const user = userEvent.setup({ applyAccept: false });
    renderForm('en');
    await fillIdea(user);

    await user.upload(screen.getByLabelText('Upload cover'), new File(['gif'], 'cover.gif', { type: 'image/gif' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a JPEG, PNG or WebP image.');
    expect(mocks.upload).not.toHaveBeenCalled();

    const file = new File(['png'], 'cover.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Upload cover'), file);
    expect(mocks.upload).toHaveBeenCalledWith(file, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    // The file input gives way to Cancel while uploading; focus follows it, then returns.
    expect(screen.getByRole('button', { name: 'Cancel upload' })).toHaveFocus();
    act(() => progress?.(40));
    expect(screen.getByRole('progressbar', { name: 'Cover upload progress' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('button', { name: 'Submit proposal' })).toBeDisabled();
    await act(async () => finish?.({ assetId: 'asset_cover1', url: '/api/v1/media/asset_cover1', name: 'cover.png', size: 3, mime: 'image/png' }));

    const preview = screen.getByRole('img', { name: 'Cover preview' });
    expect(preview).toHaveAttribute('src', 'blob:cover-preview');
    expect(preview.parentElement).toHaveClass('vf-proposal-cover-frame');
    expect(screen.getByLabelText('Replace cover')).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Remove cover' }));
    expect(screen.queryByRole('img', { name: 'Cover preview' })).toBeNull();
    expect(screen.getByLabelText('Upload cover')).toHaveFocus();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-preview');

    mocks.upload.mockResolvedValueOnce({ assetId: 'asset_cover2', url: '/api/v1/media/asset_cover2', name: 'cover.png', size: 3, mime: 'image/png' });
    await user.upload(screen.getByLabelText('Upload cover'), file);
    expect(await screen.findByRole('img', { name: 'Cover preview' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Submit proposal' }));
    expect(sentBody(fetchMock).coverAssetId).toBe('asset_cover2');
  });

  it('reports a failed cover upload inline and retries it', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ assetId: 'asset_cover2', url: '/api/v1/media/asset_cover2', name: 'c.webp', size: 1, mime: 'image/webp' });
    const user = userEvent.setup();
    renderForm('en');

    await user.upload(screen.getByLabelText('Upload cover'), new File(['w'], 'c.webp', { type: 'image/webp' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The cover could not be uploaded.');
    await user.click(screen.getByRole('button', { name: 'Retry upload' }));
    expect(await screen.findByRole('img', { name: 'Cover preview' })).toBeDefined();
    expect(mocks.upload).toHaveBeenCalledTimes(2);
  });
});

describe('proposal submitted notice', () => {
  it('announces the submission once and strips the query while staying visible', () => {
    const view = render(<Provider><ProposalSubmittedNotice show cleanHref="/app/projects/climate-lab" /></Provider>);

    expect(screen.getByRole('status')).toHaveTextContent('Proposal submitted for review.');
    expect(mocks.router.replace).toHaveBeenCalledWith('/app/projects/climate-lab', { scroll: false });
    view.rerender(<Provider><ProposalSubmittedNotice show={false} cleanHref="/app/projects/climate-lab" /></Provider>);
    expect(screen.getByRole('status')).toHaveTextContent('Proposal submitted for review.');
  });

  it('renders nothing without the submitted flag', () => {
    render(<Provider><ProposalSubmittedNotice show={false} cleanHref="/app/projects/climate-lab" /></Provider>);
    expect(screen.queryByRole('status')).toBeNull();
    expect(mocks.router.replace).not.toHaveBeenCalled();
  });
});

describe('project form helpers', () => {
  it('offers every catalog course, even with no skills or projects, and deduplicates skills', () => {
    expect(projectProposalOptions([
      { id: 'product-lab', title: 'Product lab', skills: [] },
      { id: 'ai-foundations', title: 'AI Foundations', skills: [{ id: 'data-literacy', name: 'Data literacy' }] },
      { id: 'ai-advanced', title: 'AI Advanced', skills: [{ id: 'data-literacy', name: 'Data literacy' }, { id: 'ethics', name: 'Ethics' }] },
    ], 'en')).toEqual({
      courses: [
        { id: 'ai-advanced', label: 'AI Advanced' },
        { id: 'ai-foundations', label: 'AI Foundations' },
        { id: 'product-lab', label: 'Product lab' },
      ],
      skills: [
        { id: 'data-literacy', label: 'Data literacy' },
        { id: 'ethics', label: 'Ethics' },
      ],
    });
  });

  it('treats the last https:// part of an output line as the URL', () => {
    expect(parseOutputLinks('Demo | https://x.dev')).toEqual([{ label: { vi: 'Demo', en: 'Demo' }, url: 'https://x.dev' }]);
    expect(parseOutputLinks('Bản chạy | Live demo | https://x.dev/run')).toEqual([{ label: { vi: 'Bản chạy', en: 'Live demo' }, url: 'https://x.dev/run' }]);
    // An explicitly empty English label round-trips as a Vietnamese-only label.
    expect(parseOutputLinks('Bản chạy |  | https://x.dev/run')).toEqual([{ label: { vi: 'Bản chạy' }, url: 'https://x.dev/run' }]);
  });

  it('labels a bare https:// line with the URL hostname', () => {
    expect(parseOutputLinks('https://www.example.com/demo')).toEqual([{ label: { vi: 'example.com', en: 'example.com' }, url: 'https://www.example.com/demo' }]);
    expect(parseOutputLinks('https://github.com/vf/lab\n | https://x.dev/run')).toEqual([
      { label: { vi: 'github.com', en: 'github.com' }, url: 'https://github.com/vf/lab' },
      { label: { vi: 'x.dev', en: 'x.dev' }, url: 'https://x.dev/run' },
    ]);
    // A labelled line keeps its label.
    expect(parseOutputLinks('Demo | https://x.dev')[0].label).toEqual({ vi: 'Demo', en: 'Demo' });
  });
});

describe('project showcase forms', () => {
  it('announces and sends the explicit desired interest state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ interested: true }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><ProjectInterestButton projectId="climate-lab" initialInterested={false} /></Provider>);

    const button = screen.getByRole('button', { name: "I'm interested" });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await user.click(button);

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects/climate-lab/interest', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ interested: true }),
    }));
    expect(screen.getByRole('button', { name: 'Interested' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Interest saved.');
  });

  it('shows the localized interest error instead of the server or network message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'PROJECT_NOT_FOUND', message: 'Project was not found' } }), { status: 404, headers: { 'content-type': 'application/json' } }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><ProjectInterestButton projectId="climate-lab" initialInterested={false} /></Provider>);

    await user.click(screen.getByRole('button', { name: "I'm interested" }));
    expect(screen.getByRole('status').textContent).toBe(en.build.interest.error);
    await user.click(screen.getByRole('button', { name: "I'm interested" }));
    expect(screen.getByRole('status').textContent).toBe(en.build.interest.error);
  });

  it('keeps approval in Central review instead of an editor checkbox', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'climate-lab', approved: true }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Provider><StudioProjectForm mode="edit" initial={{
      id: 'climate-lab',
      title: { vi: 'Khí hậu', en: 'Climate' },
      summary: { vi: 'Dự án', en: 'Project' },
      status: 'idea',
      outputLinks: [],
      skills: [],
      courseIds: [],
      ownerId: '00000000-0000-4000-8000-000000000001',
      coverAssetId: null,
      approved: false,
      branchScope: { scope: 'branches', branchIds: ['hanoi'] },
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
      members: [{
        userId: '00000000-0000-4000-8000-000000000001',
        role: 'owner',
        displayName: 'Owner',
        handle: 'owner',
      }],
      relatedCourses: [],
      interested: false,
      viewerRole: 'owner',
      canExpressInterest: false,
    }} /></Provider>);

    expect(screen.queryByRole('checkbox', { name: 'Approved for the learner showcase' })).toBeNull();
    // Section cards group the fields; the editor has exactly one save indicator.
    expect(screen.getByRole('region', { name: 'Details' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Status and audience' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Links and team' })).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Save now' })).toHaveLength(1);
    expect(screen.queryByText(/translation\. Add it before approval\./)).toBeNull();
  });

  it('saves a Vietnamese-only Studio project and shows the missing English hint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'khi-hau', updatedAt: '2026-09-26T00:00:00.000Z' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Provider><StudioProjectForm mode="create" /></Provider>);

    const titleEn = screen.getByRole('textbox', { name: 'English title' });
    expect(titleEn).toBeRequired();
    await user.type(screen.getByRole('textbox', { name: 'Project ID' }), 'khi-hau');
    await user.type(screen.getByRole('textbox', { name: 'Vietnamese title' }), 'Khí hậu');
    await user.type(screen.getByRole('textbox', { name: 'Vietnamese summary' }), 'Dự án dữ liệu.');

    expect(titleEn).not.toBeRequired();
    expect(titleEn).toHaveAccessibleDescription('Missing English translation. Add it before approval.');
    expect(screen.queryByText('Missing Vietnamese translation. Add it before approval.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/studio/projects', expect.objectContaining({ method: 'POST' })));
    const [, request] = fetchMock.mock.calls.find(([url]) => url === '/api/v1/studio/projects') as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.title).toEqual({ vi: 'Khí hậu' });
    expect(body.summary).toEqual({ vi: 'Dự án dữ liệu.' });
  });
});
