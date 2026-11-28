import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: vi.fn(), authorize: vi.fn(), database: vi.fn(), teaching: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: async () => {
  const actor = await mocks.actor();
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  return { id: actor.userId };
} }));
vi.mock('@/features/media/assessment-owner', () => ({ checkBoundAssessmentOwnerAccess: async () => null }));
vi.mock('@/features/storage-transfer/grants', () => ({ grantStorageTransferUrl: () => 'https://storage.example/authorized-fixture' }));
vi.mock('@/lib/permissions', async (load) => ({ ...await load<typeof import('@/lib/permissions')>(), getActor: mocks.actor }));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.database }));
vi.mock('@/lib/rate-limit', () => ({ RATE_LIMITS: { upload: {} }, enforceRateLimit: vi.fn(), userRateLimitKey: vi.fn() }));
vi.mock('@/features/submissions/service', () => ({ authorizeAssignmentUpload: mocks.authorize }));
vi.mock('@/features/teaching/assignments', () => ({ assertCourseTeaching: mocks.teaching }));

import { POST as reserve } from '@/app/api/v1/uploads/reserve/route';
import { PUT } from '@/app/api/v1/uploads/[uploadId]/assignment-file/route';
import { GET } from '@/app/api/v1/media/[assetId]/route';
import { directUploadFile } from '@/features/media/direct-upload-client';
import { ApiError } from '@/lib/api';

const owner = randomUUID();
const other = randomUUID();
const grader = randomUUID();
const version = randomUUID();
const course = 'pilot-course';
const item = 'pilot-assignment';
const env = 'ACADEMY_FILES_ASSIGNMENT_WRITES_ENABLED';
const path = 'https://academy.example';
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

type Row = Record<string, unknown>;

function fixture() {
  const rows: Record<string, Row[]> = {
    academy_assignment_files: [], media_upload_reservations: [], media_assets: [], assignment_submissions: [], submission_files: [],
    course_versions: [{ id: version, course_id: course }],
    enrollments: [{ user_id: owner, course_id: course, course_version_id: version, status: 'active', branch_scope_known: true, branch_id: 'school-a' }],
  };
  const stored = new Map<string, { fileId: string; bytes: Uint8Array }>();
  const attempts: string[] = [];
  const database = {
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.example/fixture' }, error: null }) }) },
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      const found = () => rows[table].filter(row => filters.every(filter => filter(row)));
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => { filters.push(row => row[field] === value); return query; },
        in: (field: string, values: unknown[]) => { filters.push(row => values.includes(row[field])); return query; },
        maybeSingle: async () => ({ data: found()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => void) => resolve({ data: found(), error: null }),
        insert: async (row: Row) => {
          rows[table].push({ ...row, file_id: null, cancelled_at: null, expires_at: new Date(Date.now() + 60_000).toISOString() });
          return { error: null };
        },
      };
      return query;
    },
    async rpc(name: string, args: Row) {
      if (name !== 'academy_assignment_file_complete') throw new Error('Unexpected RPC ' + name);
      const entry = rows.academy_assignment_files.find(row => row.operation_id === args.p_operation && row.owner_id === args.p_owner)!;
      entry.file_id = args.p_file;
      rows.media_assets.push({
        id: entry.asset_id, owner_id: entry.owner_id, bucket: 'submissions',
        path: `${entry.owner_id}/vfuture-files/${entry.operation_id}`, mime: 'application/pdf', size_bytes: entry.size_bytes,
      });
      return { data: entry, error: null };
    },
  };
  mocks.database.mockReturnValue(database);
  let failFirstUpload = true;
  const files = vi.fn(async (url: string, options: RequestInit) => {
    expect(new URL(url).origin).toBe('https://files.vfuturelabs.org');
    const headers = new Headers(options.headers);
    expect(headers.get('x-files-record-proof')).toMatch(/^\d{10}\.[0-9a-f]{64}$/);
    if (options.method === 'POST') {
      const operation = headers.get('idempotency-key')!;
      attempts.push(operation);
      const form = options.body as FormData;
      expect(form.get('sourceRef')).toBe(headers.get('x-files-source-ref'));
      const bytes = new Uint8Array(await (form.get('file') as File).arrayBuffer());
      const record = stored.get(operation) ?? { fileId: randomUUID(), bytes };
      stored.set(operation, record);
      if (failFirstUpload) { failFirstUpload = false; throw new Error('response lost after upload'); }
      return Response.json({ file: { fileId: record.fileId, sha256: sha(bytes), sizeBytes: bytes.length, contentType: 'application/pdf' } });
    }
    const file = [...stored.values()].find(entry => url.endsWith('/' + entry.fileId + '/download'))!;
    return new Response(Uint8Array.from(file.bytes), { headers: { 'content-type': 'application/pdf' } });
  });
  vi.stubGlobal('fetch', files);
  const learnerFetch = (async (url: string, init: RequestInit) => {
    const request = new Request(path + url, init);
    if (url.endsWith('/reserve')) return reserve(request);
    const uploadId = url.split('/').at(-2)!;
    return PUT(request, { params: Promise.resolve({ uploadId }) });
  }) as typeof fetch;
  const upload = (value: string) => directUploadFile(new File([value], 'work.pdf', { type: 'application/pdf' }),
    { purpose: 'submission', courseId: course, itemId: item, blockId: null }, { fetchImpl: learnerFetch });
  const download = (assetId: string) => GET(new Request(path + '/api/v1/media/' + assetId), { params: Promise.resolve({ assetId }) });
  return { rows, stored, attempts, files, upload, download };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ACADEMY_FILES_ASSIGNMENT_COURSE_ID', course);
  vi.stubEnv('ACADEMY_FILES_ASSIGNMENT_ITEM_ID', item);
  vi.stubEnv(env, 'true');
  vi.stubEnv('ACADEMY_FILES_ASSIGNMENT_TOKEN', 'vfs1.academyassignment.' + 'a'.repeat(43));
  vi.stubEnv('ACADEMY_FILES_ASSIGNMENT_PROOF_KEY', 'a'.repeat(64));
  mocks.actor.mockResolvedValue({ userId: owner, roles: [] });
  mocks.authorize.mockResolvedValue({ courseVersionId: version, itemId: item });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('retries the actual learner upload transport and keeps replacement and rollback reads bound to independent versions', async () => {
  const h = fixture();
  const first = await h.upload('%PDF-1.4\nfirst\n%%EOF\n');
  expect(h.attempts).toHaveLength(2);
  expect(h.attempts[0]).toBe(h.attempts[1]);
  expect(h.stored.size).toBe(1);
  expect(h.rows.media_assets).toHaveLength(1);
  const second = await h.upload('%PDF-1.4\nreplacement\n%%EOF\n');
  expect(second.assetId).not.toBe(first.assetId);
  expect(h.stored.size).toBe(2);
  vi.stubEnv(env, 'false');
  const download = await h.download(first.assetId);
  expect(download.status).toBe(200);
  expect(download.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await download.text()).toContain('first');
  expect(await (await h.download(second.assetId)).text()).toContain('replacement');
  h.rows.media_assets.push({ id: 'asset_legacy', owner_id: owner, bucket: 'submissions', path: owner + '/legacy.pdf', mime: 'application/pdf', size_bytes: 20 });
  const legacy = await h.download('asset_legacy');
  expect(legacy.status).toBe(302);
  expect(legacy.headers.get('location')).toBe('https://storage.example/authorized-fixture');
});

it('denies a wrong learner, a wrong submission school and a revoked learner before fetching bytes', async () => {
  const h = fixture();
  const first = await h.upload('%PDF-1.4\nfirst\n%%EOF\n');
  const submit = randomUUID();
  h.rows.submission_files.push({ asset_id: first.assetId, user_id: owner, submission_id: submit });
  h.rows.assignment_submissions.push({
    id: submit, user_id: owner, course_version_id: version, item_id: item, block_id: null,
    branch_scope_known: true, branch_id: 'school-a',
  });
  h.files.mockClear();
  mocks.actor.mockResolvedValue(null);
  expect((await h.download(first.assetId)).status).toBe(401);
  mocks.actor.mockResolvedValue({ userId: other, roles: [] });
  mocks.teaching.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Permission denied'));
  expect((await h.download(first.assetId)).status).toBe(404);
  mocks.actor.mockResolvedValue({ userId: grader, roles: [] });
  mocks.teaching.mockResolvedValue(undefined);
  h.rows.assignment_submissions[0].branch_id = 'school-b';
  expect((await h.download(first.assetId)).status).toBe(404);
  mocks.actor.mockResolvedValue({ userId: owner, roles: [] });
  mocks.authorize.mockRejectedValue(new ApiError(403, 'NOT_ENROLLED', 'Enrollment ended'));
  expect((await h.download(first.assetId)).status).toBe(404);
  expect(h.files).not.toHaveBeenCalled();

  mocks.actor.mockResolvedValue({ userId: grader, roles: [] });
  h.rows.assignment_submissions[0].branch_id = 'school-a';
  expect((await h.download(first.assetId)).status).toBe(200);
  expect(mocks.teaching).toHaveBeenLastCalledWith(expect.objectContaining({ userId: grader }), 'submission.grade', course, 'school-a');
});
