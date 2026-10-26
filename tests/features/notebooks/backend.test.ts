import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
vi.mock('@/features/submissions/service', () => ({ session: vi.fn().mockResolvedValue({ attemptsUsed: 0 }) }));

import type { Actor } from '@/lib/permissions';
import type { NotebookContext } from '@/features/notebooks/access';
import {
  beginNotebookUpload,
  finalizeNotebookUpload,
  resolveNotebookDependencies,
  type ArtifactRow,
} from '@/features/notebooks/storage';
import { notebookSession, saveNotebookDraft } from '@/features/notebooks/service';
import { readSubmissionNotebook } from '@/features/notebooks/submission-read';

type Result = { data: unknown; error: unknown };
const ok = (data: unknown): Result => ({ data, error: null });

class Query implements PromiseLike<Result> {
  readonly operations: unknown[][] = [];
  constructor(private readonly result: Result) {}
  select(value: string) { this.operations.push(['select', value]); return this; }
  insert(value: unknown) { this.operations.push(['insert', value]); return this; }
  eq(key: string, value: unknown) { this.operations.push(['eq', key, value]); return this; }
  is(key: string, value: unknown) { this.operations.push(['is', key, value]); return this; }
  maybeSingle() { this.operations.push(['maybeSingle']); return Promise.resolve(this.result); }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) { return Promise.resolve(this.result).then(onfulfilled, onrejected); }
}

class FakeDatabase {
  readonly queries: Array<{ table: string; query: Query }> = [];
  readonly rpcCalls: Array<[string, Record<string, unknown>]> = [];
  readonly storageCalls: Array<[string, ...unknown[]]> = [];
  constructor(
    private readonly results: Record<string, Result[]> = {},
    private readonly downloads: Result[] = [],
    private readonly uploads: Result[] = [],
  ) {}
  from(table: string) {
    const query = new Query(this.results[table]?.shift() ?? ok(null));
    this.queries.push({ table, query });
    return query;
  }
  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push([name, args]);
    return Promise.resolve(this.results[`rpc:${name}`]?.shift() ?? ok(null));
  }
  storage = {
    from: (_bucket: string) => ({
      createSignedUploadUrl: async (path: string, options: unknown) => {
        this.storageCalls.push(['createSignedUploadUrl', path, options]);
        return this.results.createSignedUploadUrl?.shift() ?? ok({ signedUrl: 'https://upload.example' });
      },
      download: async (path: string) => {
        this.storageCalls.push(['download', path]);
        return this.downloads.shift() ?? { data: null, error: new Error('missing') };
      },
      upload: async (path: string, bytes: Uint8Array, options: unknown) => {
        this.storageCalls.push(['upload', path, bytes, options]);
        return this.uploads.shift() ?? ok({ path });
      },
      remove: async (paths: string[]) => {
        this.storageCalls.push(['remove', paths]);
        return ok(null);
      },
      createSignedUrl: async (path: string, seconds: number) => {
        this.storageCalls.push(['createSignedUrl', path, seconds]);
        return ok({ signedUrl: 'https://read.example' });
      },
    }),
  };
}

const actor: Actor = { userId: '11111111-1111-4111-8111-111111111111', roles: [] };
const notebook = {
  runtimeMode: 'jupyterlite' as const,
  templateAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  templateChecksum: 'a'.repeat(64),
  runtimeProfileId: 'python-data-v1' as const, runtimeProfileVersion: '1' as const, datasets: [],
};
const context: NotebookContext = {
  courseId: 'course-1', courseVersionId: '22222222-2222-4222-8222-222222222222',
  itemId: 'assignment-1', blockId: null, notebook, studio: false,
};
const artifact = (overrides: Partial<ArtifactRow> = {}): ArtifactRow => ({
  id: '33333333-3333-4333-8333-333333333333', owner_id: actor.userId,
  course_id: context.courseId, course_version_id: context.courseVersionId,
  item_id: context.itemId, block_id: context.blockId, purpose: 'draft', checksum: 'b'.repeat(64),
  template_asset_id: notebook.templateAssetId, template_checksum: notebook.templateChecksum,
  runtime_profile_id: notebook.runtimeProfileId, runtime_profile_version: notebook.runtimeProfileVersion,
  size_bytes: 100, mime: 'application/x-ipynb+json', filename: 'work.ipynb',
  storage_path: `${actor.userId}/work.ipynb`, status: 'ready', created_at: new Date().toISOString(),
  ...overrides,
});

describe('notebook upload authorization', () => {
  it('denies cross-scope uploads before reserving storage', async () => {
    const database = new FakeDatabase();
    await expect(beginNotebookUpload(actor, context, {
      purpose: 'template', filename: 'template.ipynb', sizeBytes: 100, checksum: 'a'.repeat(64),
    }, database as never)).rejects.toMatchObject({ status: 403, code: 'NOTEBOOK_UPLOAD_SCOPE' });
    expect(database.queries).toEqual([]);
    expect(database.storageCalls).toEqual([]);
  });

  it('denies finalization for another actor or assignment target before downloading bytes', async () => {
    const database = new FakeDatabase({ notebook_artifacts: [ok(artifact({ owner_id: '44444444-4444-4444-8444-444444444444' }))] });
    await expect(finalizeNotebookUpload(actor, context, artifact().id, database as never))
      .rejects.toMatchObject({ status: 404, code: 'NOTEBOOK_ASSET_NOT_FOUND' });
    expect(database.storageCalls).toEqual([]);
  });
});

describe('notebook finalization', () => {
  it('returns an already-ready artifact without mutating storage or the database', async () => {
    const ready = artifact();
    const database = new FakeDatabase({ notebook_artifacts: [ok(ready)] });
    await expect(finalizeNotebookUpload(actor, context, ready.id, database as never)).resolves.toEqual(ready);
    expect(database.storageCalls).toEqual([]);
    expect(database.rpcCalls).toEqual([]);
  });

  it('rejects checksum and size mismatches as validation failures', async () => {
    const bytes = new TextEncoder().encode('{}');
    const wrongChecksum = new FakeDatabase(
      { notebook_artifacts: [ok(artifact({ status: 'pending', size_bytes: bytes.byteLength }))] },
      [ok(new Blob([bytes]))],
    );
    await expect(finalizeNotebookUpload(actor, context, artifact().id, wrongChecksum as never))
      .rejects.toMatchObject({ status: 422, code: 'NOTEBOOK_CHECKSUM_MISMATCH' });

    const wrongSize = new FakeDatabase(
      { notebook_artifacts: [ok(artifact({ status: 'pending', size_bytes: bytes.byteLength + 1 }))] },
      [ok(new Blob([bytes]))],
    );
    await expect(finalizeNotebookUpload(actor, context, artifact().id, wrongSize as never))
      .rejects.toMatchObject({ status: 422, code: 'NOTEBOOK_SIZE_MISMATCH' });
  });

  it('sanitizes template bytes and commits the resulting checksum before deleting the pending object', async () => {
    const document = {
      nbformat: 4, nbformat_minor: 5, metadata: { trusted: true },
      cells: [{ cell_type: 'code', metadata: { trusted: true }, source: 'print(1)', execution_count: 1, outputs: [{ output_type: 'stream', text: '1' }] }],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(document));
    const rawChecksum = createHash('sha256').update(bytes).digest('hex');
    const pending = artifact({
      status: 'pending', purpose: 'template', course_version_id: null,
      template_asset_id: null, template_checksum: null, size_bytes: bytes.byteLength,
      checksum: rawChecksum, filename: 'template.ipynb', storage_path: 'pending/template.ipynb',
    });
    const ready = { ...pending, status: 'ready' as const, storage_path: `ready/${actor.userId}/${pending.id}/template.ipynb` };
    const database = new FakeDatabase(
      { notebook_artifacts: [ok(pending), ok(ready)], 'rpc:finalize_notebook_artifact': [ok(null)] },
      [ok(new Blob([bytes]))],
    );

    await expect(finalizeNotebookUpload(actor, { ...context, studio: true, courseVersionId: null }, pending.id, database as never))
      .resolves.toEqual(ready);
    const finalized = database.rpcCalls[0][1];
    expect(finalized.p_checksum).not.toBe(rawChecksum);
    const upload = database.storageCalls.find(([name]) => name === 'upload');
    expect(new TextDecoder().decode(upload?.[2] as Uint8Array)).toContain('"execution_count":null');
    expect(database.storageCalls.at(-1)).toEqual(['remove', ['pending/template.ipynb']]);
  });

  it('returns malformed notebook JSON as a 4xx validation error', async () => {
    const bytes = new TextEncoder().encode('{bad json');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const database = new FakeDatabase(
      { notebook_artifacts: [ok(artifact({ status: 'pending', size_bytes: bytes.byteLength, checksum }))] },
      [ok(new Blob([bytes]))],
    );
    await expect(finalizeNotebookUpload(actor, context, artifact().id, database as never))
      .rejects.toMatchObject({ status: 422, code: 'NOTEBOOK_INVALID' });
  });
});

describe('notebook drafts and dependencies', () => {
  it('keeps a learner draft pinned to the authenticated target and reports revision conflicts', async () => {
    const row = artifact();
    const database = new FakeDatabase({
      notebook_artifacts: [ok(row)],
      'rpc:save_notebook_draft': [ok({ conflict: true })],
    });
    await expect(saveNotebookDraft(actor, context, { artifactId: row.id, expectedRevision: 1 }, database as never))
      .rejects.toMatchObject({ status: 409, code: 'NOTEBOOK_DRAFT_CONFLICT' });
    expect(database.rpcCalls[0][1]).toMatchObject({
      p_user_id: actor.userId, p_course_version_id: context.courseVersionId,
      p_item_id: context.itemId, p_block_id: null, p_artifact_id: row.id, p_expected_revision: 1,
    });
  });

  it('rejects a draft session artifact from a different target', async () => {
    const template = artifact({
      id: notebook.templateAssetId, owner_id: '55555555-5555-4555-8555-555555555555',
      purpose: 'template', course_version_id: null, template_asset_id: null, template_checksum: null,
      checksum: notebook.templateChecksum, filename: 'template.ipynb', size_bytes: 100,
    });
    const database = new FakeDatabase({
      notebook_artifacts: [ok(template), ok(artifact({ item_id: 'other-assignment' }))],
      notebook_drafts: [ok({ revision: 1, artifact_id: artifact().id })],
    });
    await expect(notebookSession(actor, context, database as never))
      .rejects.toMatchObject({ status: 404, code: 'NOTEBOOK_ASSET_NOT_FOUND' });
  });

  it('returns a target-pinned draft session with signed dependencies', async () => {
    const template = artifact({
      id: notebook.templateAssetId, owner_id: '55555555-5555-4555-8555-555555555555',
      purpose: 'template', course_version_id: null, template_asset_id: null, template_checksum: null,
      checksum: notebook.templateChecksum, filename: 'template.ipynb', size_bytes: 100,
    });
    const draft = artifact();
    const database = new FakeDatabase({
      notebook_artifacts: [ok(template), ok(draft)],
      notebook_drafts: [ok({ revision: 2, artifact_id: draft.id })],
    });

    await expect(notebookSession(actor, context, database as never)).resolves.toMatchObject({
      userId: actor.userId,
      courseVersionId: context.courseVersionId,
      draft: { revision: 2, artifact: { assetId: draft.id, checksum: draft.checksum } },
      template: { assetId: template.id, checksum: template.checksum },
      datasets: [],
      assignment: { attemptsUsed: 0 },
    });
  });

  it('exports publication dependency validation without creating signed URLs', async () => {
    const template = artifact({
      id: notebook.templateAssetId, owner_id: '55555555-5555-4555-8555-555555555555',
      purpose: 'template', course_version_id: null, template_asset_id: null, template_checksum: null,
      checksum: notebook.templateChecksum, filename: 'template.ipynb', size_bytes: 100,
    });
    const database = new FakeDatabase({ notebook_artifacts: [ok(template)] });
    await expect(resolveNotebookDependencies(context, notebook, database as never)).resolves.toEqual([template]);
    expect(database.storageCalls).toEqual([]);
  });
});

describe('submitted notebook viewer authorization',()=>{
  it('rejects a suspended persisted actor before reading the private submission',async()=>{
    const database=new FakeDatabase();
    await expect(readSubmissionNotebook({
      userId:actor.userId,roles:[],authorization:{source:'database',accountStatus:'suspended',memberships:[],assignments:[]},
    },'33333333-3333-4333-8333-333333333333',database as never)).rejects.toMatchObject({status:403,code:'ACCOUNT_INACTIVE'});
    expect(database.queries).toEqual([]);
    expect(database.storageCalls).toEqual([]);
  });
});


describe('gateway notebook grants', () => {
  afterEach(() => vi.unstubAllEnvs());
  function enableGateway(database: FakeDatabase) {
    vi.stubEnv('SUPABASE_GATEWAY_KEY', 'gateway-test');
    vi.stubEnv('SUPABASE_TRANSFER_GRANT_KEY', 'transfer-test-secret-'.repeat(3));
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://storage.example');
    const original = database.storage.from;
    database.storage.from = (bucket: string) => ({
      ...original(bucket),
      createSignedUrl: async (path: string) => ok({ signedUrl: `https://storage.example/storage/v1/object/sign/${bucket}/${path}?token=signed` }),
      createSignedUploadUrl: async (path: string) => ok({ signedUrl: `https://storage.example/storage/v1/object/upload/sign/${bucket}/${path}?token=signed` }),
    });
  }
  function claims(url: string) {
    const grant = new URL(url).searchParams.get('gateway_grant');
    expect(grant).toBeTruthy();
    return JSON.parse(Buffer.from(grant!.split('.')[0], 'base64url').toString());
  }
  it('charges a shared template download to the learner viewer, not the author', async () => {
    const template = artifact({ owner_id: '44444444-4444-4444-8444-444444444444', purpose: 'template', id: notebook.templateAssetId, checksum: notebook.templateChecksum, filename: 'template.ipynb' });
    const database = new FakeDatabase({ notebook_artifacts: [ok(template)], notebook_drafts: [ok(null)] });
    enableGateway(database);
    const result = await notebookSession(actor, context, database as never);
    expect(claims(result.template!.url)).toMatchObject({ sub: actor.userId, maxBytes: 100, method: 'GET' });
  });
  it('binds the upload grant to validated reservation bytes and uploader', async () => {
    const database = new FakeDatabase(); enableGateway(database);
    const result = await beginNotebookUpload(actor, context, { purpose: 'draft', filename: 'work.ipynb', sizeBytes: 1234, checksum: 'a'.repeat(64) }, database as never);
    expect(claims(result.url)).toMatchObject({ sub: actor.userId, maxBytes: 1234, method: 'PUT', path: expect.stringMatching(/^\/storage\/v1\/object\/upload\/sign\/notebooks\/pending\//) });
  });
  it('charges an authorized grader rather than the submission owner', async () => {
    const row = artifact({ purpose: 'submission' });
    const database = new FakeDatabase({ assignment_submissions: [ok({ id: 'submission-1', user_id: actor.userId, course_version_id: row.course_version_id, item_id: row.item_id, block_id: row.block_id, branch_id: 'school-1', branch_scope_known: true, payload: { notebook: { assetId: row.id, checksum: row.checksum } } })], notebook_artifacts: [ok(row)] });
    enableGateway(database);
    const grader: Actor = { userId: '55555555-5555-4555-8555-555555555555', roles: [], authorization: { source: 'database', accountStatus: 'active', memberships: [{ branchId: 'school-1', status: 'active' }], assignments: [{ roleDefinitionId: 'grader', scope: { kind: 'branch', branchId: 'school-1' }, permissions: ['submission.grade'] }] } };
    const result = await readSubmissionNotebook(grader, 'submission-1', database as never);
    expect(claims(result.url).sub).toBe(grader.userId);
  });
});
