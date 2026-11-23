import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  checkPublicRateLimit: vi.fn(),
  applyPublicResponseHeaders: vi.fn((response: Response) => response),
  supabaseService: vi.fn(),
  rpc: vi.fn(),
  sign: vi.fn(),
}));

vi.mock('@/features/marketing/public-http', () => ({
  checkPublicRateLimit: mocks.checkPublicRateLimit,
  applyPublicResponseHeaders: mocks.applyPublicResponseHeaders,
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import { GET } from '@/app/api/v1/public/media/[assetId]/route';

const assetId = 'asset_cover';
const cover = { bucket: 'media', path: 'public.png', size_bytes: 2000, source_kind: 'course', parent_id: 'course', source: null };
const image = { type: 'image', src: { assetId }, alt: 'Cover' };
const guide = {
  schemaVersion: 1, kind: 'resource', id: 'guide', title: 'Guide', summary: 'Summary', resourceType: 'guide',
  body: { blocks: [image] },
};
function getMedia() {
  return GET(new Request(`https://example.test/api/v1/public/media/${assetId}`), {
    params: Promise.resolve({ assetId }),
  });
}

describe('public media route', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.checkPublicRateLimit.mockReturnValue({ allowed: true, headers: new Headers() });
    mocks.applyPublicResponseHeaders.mockImplementation((response: Response) => response);
    mocks.supabaseService.mockReturnValue({
      rpc: mocks.rpc,
      storage: { from: () => ({ createSignedUrl: mocks.sign }) },
    });
    vi.stubEnv('HIDE_INTERNAL_CONTENT', '');
    vi.stubEnv('INTERNAL_CONTENT_IDS', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns 429 before looking up public media', async () => {
    mocks.checkPublicRateLimit.mockReturnValue({ allowed: false, headers: new Headers() });
    const response = await getMedia();
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.supabaseService).not.toHaveBeenCalled();
  });

  it('performs one lookup on a miss with the current prefix and configured valid parent IDs', async () => {
    vi.stubEnv('HIDE_INTERNAL_CONTENT', '1');
    vi.stubEnv('INTERNAL_CONTENT_IDS', ' preview-guide ,invalid/id,preview-guide');
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    expect((await getMedia()).status).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('academy_public_media_asset', expect.objectContaining({
      p_asset_id: assetId, p_hidden_prefix: 'recovery-', p_hidden_ids: ['preview-guide'],
    }));
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('returns an outage when the database cannot resolve access', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'lookup unavailable' } });
    expect((await getMedia()).status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it.each(['notebooks', 'certificates', 'submissions', 'unknown'])('declines to sign a result in bucket %s', async (bucket) => {
    mocks.rpc.mockResolvedValue({ data: [{ ...cover, bucket }], error: null });
    expect((await getMedia()).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it.each([
    ['resource', { ...guide, title: 42 }],
    ['resource', { ...guide, body: { blocks: [{ type: 'diagram', src: { assetId }, alt: 'Reserved' }] } }],
    ['opportunity', { en: { blocks: [{ type: 'paragraph', content: [{ text: 'Text' }], extra: { assetId } }] } }],
    ['opportunity', { vi: { blocks: [{ type: 'divider' }] }, en: { blocks: [image, { type: 'invalid' }] } }],
  ])('requires a rendered reference in a valid %s projection', async (kind, source) => {
    mocks.rpc.mockResolvedValue({ data: [{ ...cover, source_kind: kind, parent_id: 'guide', source }], error: null });
    expect((await getMedia()).status).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('continues past invalid candidate parents and signs a localized opportunity poster', async () => {
    const source = { en: { blocks: [{ type: 'callout', variant: 'tip', blocks: [
      { type: 'video', src: { url: 'https://example.test/talk.mp4' }, poster: { assetId } },
    ] }] } };
    mocks.rpc.mockImplementation(async (_name, args) => ({
      data: args.p_after_kind === ''
        ? Array.from({ length: args.p_page_size }, (_, index) => ({
          ...cover, source_kind: 'opportunity', parent_id: `earlier-${index}`, source: { blocks: [image, { type: 'invalid' }] },
        }))
        : [{ ...cover, source_kind: 'opportunity', parent_id: 'workshop', source }],
      error: null,
    }));
    mocks.sign.mockResolvedValue({ data: { signedUrl: 'https://storage.example/public.png' }, error: null });
    expect((await getMedia()).status).toBe(302);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    const first = mocks.rpc.mock.calls[0][1];
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({
      p_asset_id: assetId, p_after_kind: 'opportunity', p_after_id: `earlier-${first.p_page_size - 1}`,
    });
  });

  it.each([
    { ...guide, body: { vi: { blocks: [image] } } },
    { ...guide, body: { blocks: [{ type: 'divider' }] }, attachments: [{ src: { assetId }, label: 'Download' }] },
  ])('signs a file used by a validated resource body or attachment', async (source) => {
    mocks.rpc.mockResolvedValue({ data: [{ ...cover, source_kind: 'resource', parent_id: 'guide', source }], error: null });
    mocks.sign.mockResolvedValue({ data: { signedUrl: 'https://storage.example/public.png' }, error: null });
    expect((await getMedia()).status).toBe(302);
  });

  it('signs a visible file with its public byte bound and honors revoked access on the next request', async () => {
    vi.stubEnv('INTERNAL_CONTENT_IDS', 'preview-guide');
    vi.stubEnv('SUPABASE_GATEWAY_KEY', 'gateway-test');
    vi.stubEnv('SUPABASE_TRANSFER_GRANT_KEY', 'transfer-test-secret-'.repeat(3));
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.example');
    mocks.rpc.mockResolvedValueOnce({ data: [cover], error: null });
    mocks.sign.mockResolvedValue({ data: { signedUrl: 'https://storage.example/storage/v1/object/sign/media/public.png?token=signed' }, error: null });

    const response = await getMedia();
    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('academy_public_media_asset', expect.objectContaining({
      p_asset_id: assetId, p_hidden_prefix: null, p_hidden_ids: [],
    }));
    const grant = new URL(response.headers.get('location')!).searchParams.get('gateway_grant')!;
    expect(JSON.parse(Buffer.from(grant.split('.')[0], 'base64url').toString())).toMatchObject({ sub: 'public', maxBytes: 2000 });

    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await getMedia()).status).toBe(404);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });
});
