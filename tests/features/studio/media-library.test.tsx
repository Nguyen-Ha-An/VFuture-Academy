// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { MediaLibrary } from '@/features/studio/ui/MediaLibrary';
import { requestNavigation } from '@/lib/navigation-guard';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const assets = [
  { id: 'asset_IMAGE', mime: 'image/png', sizeBytes: 2048, width: 640, height: 480, filename: 'diagram.png', alt: { vi: '', en: '' }, createdAt: '2026-09-03T00:00:00Z', usages: [{ source: 'draft' as const, courseId: 'course-a', itemId: 'lesson-1', version: null }] },
  { id: 'asset_PDF', mime: 'application/pdf', sizeBytes: 4096, width: null, height: null, filename: 'guide.pdf', alt: { vi: '', en: '' }, createdAt: '2026-09-03T00:00:00Z', usages: [] },
];

const messages = staffUiTestMessages(en, 'en');

/** Alt text, previews and usages live in the one details sheet; open it from the file tile. */
function openDetails(filename: string) {
  fireEvent.click(screen.getByRole('button', { name: `Open details for ${filename}` }));
}

describe('MediaLibrary', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/workflow')) return new Response(JSON.stringify({ data: { content: { contentType: 'media_asset', contentId: url.includes('asset_PDF') ? 'asset_PDF' : 'asset_IMAGE', revisionKey: 'rev-1', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } } }));
      if (init?.method === 'PUT') return new Response(JSON.stringify({ data: { id: 'asset_IMAGE', alt: { vi: 'Sơ đồ', en: 'Diagram' }, revisionKey: 'rev-2' } }), { status: 200 });
      return new Response(JSON.stringify({ data: { id: 'asset_IMAGE', alt: { vi: '', en: '' }, revisionKey: 'rev-1' } }), { status: 200 });
    }));
  });
  afterEach(cleanup);

  it('asks once for a dirty alt editor in the details sheet, stays without saving, and cleans up its guard', async () => {
    const view = render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={assets} /></NextIntlClientProvider>);
    openDetails('diagram.png');
    const first = await screen.findByLabelText('English alt text for asset_IMAGE');
    await waitFor(() => expect(first).toBeEnabled());
    fireEvent.change(first, { target: { value: 'First edit' } });
    let leaving!: Promise<boolean>;
    act(() => { leaving = requestNavigation(); });
    // One leave dialog, stacked over the details sheet.
    expect(screen.getAllByRole('dialog', { name: en.studioWorkspace.leaveTitle })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(await leaving).toBe(false);
    expect(first).toHaveValue('First edit');
    view.unmount();
    expect(await requestNavigation()).toBe(true);
  });

  it('saves the open alt editor before switching assets and flushes the next one before leaving', async () => {
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    const savedIds: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PUT') return originalFetch(input, init);
      savedIds.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ data: { alt: JSON.parse(String(init.body)).alt, revisionKey: 'rev-2' } })));
    }));
    render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={assets} /></NextIntlClientProvider>);
    openDetails('diagram.png');
    const first = await screen.findByLabelText('English alt text for asset_IMAGE');
    await waitFor(() => expect(first).toBeEnabled());
    fireEvent.change(first, { target: { value: 'Image description' } });
    // Closing a dirty sheet asks the same question as leaving the page.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Save draft' })); });
    await waitFor(() => expect(screen.queryByLabelText('English alt text for asset_IMAGE')).not.toBeInTheDocument());
    openDetails('guide.pdf');
    const second = await screen.findByLabelText('English alt text for asset_PDF');
    await waitFor(() => expect(second).toBeEnabled());
    fireEvent.change(second, { target: { value: 'Document description' } });
    let leaving!: Promise<boolean>;
    act(() => { leaving = requestNavigation(); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save draft' })); });
    expect(await leaving).toBe(true);
    expect(savedIds.sort()).toEqual(['/api/v1/studio/media/asset_IMAGE', '/api/v1/studio/media/asset_PDF']);
  });

  it('waits for an older save and saves newer alt text before allowing navigation', async () => {
    let finishOlder!: (response: Response) => void;
    const originalFetch = vi.mocked(fetch).getMockImplementation()!;
    const saves: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PUT') return originalFetch(input, init);
      saves.push(String(init.body));
      if (saves.length === 1) return new Promise<Response>(resolve => { finishOlder = resolve; });
      return Promise.resolve(new Response(JSON.stringify({ data: { alt: JSON.parse(String(init.body)).alt, revisionKey: 'rev-3' } })));
    }));
    render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={[assets[0]]} /></NextIntlClientProvider>);
    openDetails('diagram.png');
    const input = await screen.findByLabelText('English alt text for asset_IMAGE');
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Older' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save now' }));
    fireEvent.change(input, { target: { value: 'Newest' } });
    let leaving!: Promise<boolean>;
    act(() => { leaving = requestNavigation(); });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await act(async () => { finishOlder(new Response(JSON.stringify({ data: { alt: { vi: '', en: 'Older' }, revisionKey: 'rev-2' } }))); });
    await expect(leaving).resolves.toBe(true);
    expect(saves).toHaveLength(2);
    expect(JSON.parse(saves[1]).alt.en).toBe('Newest');
  });

  it('does not allow Save to leave while an upload is pending', async () => {
    let finishUpload!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finishUpload = resolve; })));
    const view = render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={[]} /></NextIntlClientProvider>);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['pdf'], 'pending.pdf', { type: 'application/pdf' })] } });
    let leaving!: Promise<boolean>;
    act(() => { leaving = requestNavigation(); });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stay' })).toBeEnabled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(await leaving).toBe(false);
    await act(async () => { finishUpload(new Response(JSON.stringify({ error: { message: 'Upload failed' } }), { status: 500 })); });
  });

  it('copies an asset id and saves bilingual alt text through the media route', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={assets} /></NextIntlClientProvider>);

    await user.click(screen.getByRole('button', { name: 'Open details for diagram.png' }));
    await user.click(await screen.findByRole('button', { name: 'Copy asset_IMAGE' }));
    expect(writeText).toHaveBeenCalledWith('asset_IMAGE');

    await user.type(screen.getByLabelText('Vietnamese alt text for asset_IMAGE'), 'Sơ đồ');
    await user.type(screen.getByLabelText('English alt text for asset_IMAGE'), 'Diagram');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save now' }).some((button) => !button.hasAttribute('disabled'))).toBe(true));
    await user.click(screen.getAllByRole('button', { name: 'Save now' }).find((button) => !button.hasAttribute('disabled'))!);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/studio/media/asset_IMAGE', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ alt: { vi: 'Sơ đồ', en: 'Diagram' }, expectedRevision: 'rev-1' }),
    })));
    expect(screen.getByText(/Saved at|Saved version/)).toBeInTheDocument();
  });

  it('keeps an alt edit local and pauses retry after a revision conflict', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/workflow')) return new Response(JSON.stringify({ data: { content: { contentType: 'media_asset', contentId: 'asset_IMAGE', revisionKey: 'rev-1', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } } }));
      if (init?.method === 'PUT') return new Response(JSON.stringify({ error: { message: 'Revision changed' } }), { status: 409 });
      return new Response(JSON.stringify({ data: { id: 'asset_IMAGE', alt: { vi: '', en: '' }, revisionKey: 'rev-1' } }));
    });
    vi.stubGlobal('fetch', fetcher);
    const user = userEvent.setup();
    render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={[assets[0]]} /></NextIntlClientProvider>);
    await user.click(screen.getByRole('button', { name: 'Open details for diagram.png' }));
    const viInput = await screen.findByLabelText('Vietnamese alt text for asset_IMAGE');
    await waitFor(() => expect(viInput).toBeEnabled());
    await user.type(viInput, 'Sơ đồ');
    await user.click(screen.getByRole('button', { name: 'Save now' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Revision changed');
    expect(viInput).toHaveValue('Sơ đồ');
    expect(screen.getByRole('button', { name: 'Save now' })).toBeDisabled();
  });

  it('advertises the complete explicit server allowlist of media MIME types', () => {
    const { container } = render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={assets} /></NextIntlClientProvider>);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');

    expect(input?.accept).toBe([
      'image/avif',
      'image/bmp',
      'image/gif',
      'image/heic',
      'image/heif',
      'image/jpeg',
      'image/jxl',
      'image/png',
      'image/tiff',
      'image/webp',
      'image/x-icon',
      'video/mp4',
      'audio/mpeg',
      'audio/mp4',
      'application/pdf',
      'application/zip',
      'application/json',
      'application/x-ipynb+json',
      'text/plain',
      'text/csv',
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.presentation',
    ].join(','));
    expect(input?.accept).not.toContain('image/*');
  });

  it('continues a batch after one upload fails and retries only the failed file', async () => {
    const user = userEvent.setup();
    const uploadResponses = [
      new Response(JSON.stringify({ error: { message: 'First upload failed.' } }), { status: 500 }),
      new Response(JSON.stringify({ data: { id: 'asset_SECOND', mime: 'application/pdf', sizeBytes: 6 } }), { status: 200 }),
      new Response(JSON.stringify({ data: { id: 'asset_FIRST', mime: 'application/pdf', sizeBytes: 5 } }), { status: 200 }),
    ];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/workflow')) return new Response(JSON.stringify({ data: { content: { contentType: 'media_asset', contentId: 'asset', revisionKey: 'rev-1', status: 'draft', publishedRevisionKey: null }, activeReview: null, publication: null, actions: { requestReview: true, withdrawReview: false, approveAndPublish: false, mutate: true } } }));
      if (String(url).includes('/api/v1/studio/media/')) return new Response(JSON.stringify({ data: { id: 'asset', alt: { vi: '', en: '' }, revisionKey: 'rev-1' } }));
      return uploadResponses.shift()!;
    });
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={[]} /></NextIntlClientProvider>);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Upload input missing');

    await user.upload(input, [
      new File(['first'], 'first.pdf', { type: 'application/pdf' }),
      new File(['second'], 'second.pdf', { type: 'application/pdf' }),
    ]);

    expect(await screen.findByText('second.pdf')).toBeInTheDocument();
    expect(screen.getByText('First upload failed.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute('max', '2');
    expect(fetcher.mock.calls.filter(([url]) => String(url) === '/api/v1/studio/media')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Retry first.pdf' }));
    expect(await screen.findByText('first.pdf')).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url]) => String(url) === '/api/v1/studio/media')).toHaveLength(3);
  });

  it('selects reusable assets and links every usage to its Studio destination', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={assets} /></NextIntlClientProvider>);

    await user.click(screen.getByRole('checkbox', { name: 'Select asset_IMAGE' }));
    await user.click(screen.getByRole('button', { name: 'Copy selected asset IDs' }));

    expect(writeText).toHaveBeenCalledWith('asset_IMAGE');
    await user.click(screen.getByRole('button', { name: 'Open details for diagram.png' }));
    expect(await screen.findByRole('link', { name: /course-a.*lesson-1.*draft/i })).toHaveAttribute(
      'href',
      '/studio/courses/course-a#workspace-editor',
    );
  });

  it('rejects unsupported drops before any upload request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={[]} /></NextIntlClientProvider>);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Upload input missing');

    fireEvent.change(input, { target: { files: [new File(['svg'], 'unsafe.svg', { type: 'image/svg+xml' })] } });

    expect(await screen.findByText('image/svg+xml is not a supported file type.')).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts a server-supported non-preview document when MIME and extension match', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: 'asset_ARCHIVE', mime: 'application/zip', sizeBytes: 3 },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={[]} /></NextIntlClientProvider>);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Upload input missing');

    fireEvent.change(input, { target: { files: [new File(['zip'], 'materials.zip', { type: 'application/zip' })] } });

    expect(await screen.findByText('materials.zip')).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([url, init]) => String(url) === '/api/v1/studio/media' && (init as RequestInit | undefined)?.method === 'POST')).toHaveLength(1);
  });

  it('rejects a supported MIME paired with the wrong extension before upload', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={[]} /></NextIntlClientProvider>);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Upload input missing');

    fireEvent.change(input, { target: { files: [new File(['png'], 'diagram.pdf', { type: 'image/png' })] } });

    expect(await screen.findByText('diagram.pdf does not match image/png.')).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('previews video, audio and PDF assets through the authenticated media route', async () => {
    const previewAssets = [
      { id: 'asset_VIDEO', mime: 'video/mp4', sizeBytes: 10, width: null, height: null, filename: 'clip.mp4', alt: { vi: '', en: '' }, createdAt: null, usages: [] },
      { id: 'asset_AUDIO', mime: 'audio/mpeg', sizeBytes: 10, width: null, height: null, filename: 'lesson.mp3', alt: { vi: '', en: '' }, createdAt: null, usages: [] },
      { id: 'asset_DOCUMENT', mime: 'application/pdf', sizeBytes: 10, width: null, height: null, filename: 'guide.pdf', alt: { vi: '', en: '' }, createdAt: null, usages: [] },
    ];
    render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={previewAssets} /></NextIntlClientProvider>);

    // Tiles stay light: players and PDF frames only load inside the details sheet.
    expect(screen.queryByLabelText('Preview clip.mp4')).not.toBeInTheDocument();
    openDetails('clip.mp4');
    expect(await screen.findByLabelText('Preview clip.mp4')).toHaveAttribute('src', '/api/v1/media/asset_VIDEO');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    openDetails('lesson.mp3');
    expect(await screen.findByLabelText('Preview lesson.mp3')).toHaveAttribute('src', '/api/v1/media/asset_AUDIO');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    openDetails('guide.pdf');
    expect(await screen.findByTitle('Preview guide.pdf')).toHaveAttribute('src', '/api/v1/media/asset_DOCUMENT');
  });

  it('filters files by name, type and missing alt text and switches between grid and list', async () => {
    const user = userEvent.setup();
    const described = { ...assets[0], id: 'asset_DESCRIBED', filename: 'described.png', alt: { vi: 'Ảnh', en: 'Picture' }, usages: [] };
    render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}><MediaLibrary initialAssets={[...assets, described]} /></NextIntlClientProvider>);
    const files = screen.getByRole('list', { name: 'Files' });
    expect(files).toHaveAttribute('data-view', 'grid');
    expect(screen.getAllByText('Missing alt text').filter((node) => node.closest('li'))).toHaveLength(1);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Alt text' }), 'missing');
    expect(screen.getByRole('button', { name: 'Open details for diagram.png' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open details for described.png' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open details for guide.pdf' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Alt text' }), '');
    await user.selectOptions(screen.getByRole('combobox', { name: 'File type' }), 'pdf');
    expect(screen.getByRole('button', { name: 'Open details for guide.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open details for diagram.png' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'File type' }), '');
    await user.type(screen.getByRole('searchbox', { name: 'Search by file name or ID' }), 'descr{Enter}');
    expect(screen.getByRole('button', { name: 'Open details for described.png' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open details for diagram.png' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('list', { name: 'Files' })).toHaveAttribute('data-view', 'list');
    expect(fetch).not.toHaveBeenCalled();
  });
});
