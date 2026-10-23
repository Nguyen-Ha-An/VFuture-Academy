import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  recompute: vi.fn(),
  supabaseService: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('@/features/progress/service', () => ({ recompute: mocks.recompute }));

import type { GradingItem } from '@/content-engine/compile';
import {
  createSubmissionsService,
  createServerSubmissionsService,
  SubmissionPayloadSchema,
  submissionAuditSnapshot,
  type SubmissionDatabase,
} from '@/features/submissions/service';
import type { Actor } from '@/lib/permissions';

type Result = {
  data: unknown;
  error: { code?: string; message?: string; details?: string | null } | null;
};

type Operation = [string, ...unknown[]];

class QueryStub implements PromiseLike<Result> {
  readonly operations: Operation[] = [];

  constructor(readonly table: string, private readonly result: Result) {}

  select(columns: string) { this.operations.push(['select', columns]); return this; }
  insert(value: unknown) { this.operations.push(['insert', value]); return this; }
  update(value: unknown) { this.operations.push(['update', value]); return this; }
  upsert(value: unknown, options?: unknown) { this.operations.push(['upsert', value, options]); return this; }
  delete() { this.operations.push(['delete']); return this; }
  eq(column: string, value: unknown) { this.operations.push(['eq', column, value]); return this; }
  in(column: string, values: unknown[]) { this.operations.push(['in', column, values]); return this; }
  is(column: string, value: null) { this.operations.push(['is', column, value]); return this; }
  or(filters: string) { this.operations.push(['or', filters]); return this; }
  order(column: string, options?: unknown) { this.operations.push(['order', column, options]); return this; }
  limit(value: number) { this.operations.push(['limit', value]); return this; }
  maybeSingle() { this.operations.push(['maybeSingle']); return Promise.resolve(this.result); }
  single() { this.operations.push(['single']); return Promise.resolve(this.result); }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class SupabaseStub implements SubmissionDatabase {
  readonly queries: QueryStub[] = [];
  readonly rpcCalls: Array<[string, Record<string, unknown>]> = [];

  constructor(private readonly results: Record<string, Result[]> = {}) {}

  from(table: string) {
    const query = new QueryStub(table, this.results[table]?.shift() ?? successful(null));
    this.queries.push(query);
    return query;
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push([name, args]);
    return Promise.resolve(this.results[`rpc:${name}`]?.shift() ?? successful(null));
  }

  setResults(key: string, results: Result[]) {
    this.results[key] = results;
  }
}

const successful = (data: unknown): Result => ({ data, error: null });
const failed = (message: string, code = 'P0001'): Result => ({ data: null, error: { code, message } });
const learner: Actor = { userId: 'learner-1', roles: [] };
const instructor: Actor = {
  userId: 'instructor-1',
  roles: [{ role: 'instructor', branchId: 'vinsmc' }],
};

afterEach(() => {
  vi.restoreAllMocks();
});

function grading(overrides: Partial<NonNullable<GradingItem['assignments']>[string]> = {}): GradingItem {
  return {
    questions: {},
    quizzes: {},
    rubrics: {
      assignment: {
        criteria: [
          { id: 'quality', name: 'Quality', maxPoints: 4 },
          { id: 'impact', name: 'Impact', maxPoints: 6 },
        ],
      },
    },
    assignments: {
      assignment: {
        submission: {
          accepts: ['text', 'link', 'file', 'code'],
          maxFiles: 2,
          maxFileSizeMB: 5,
          allowedMimeTypes: ['application/pdf', 'image/png'],
          linkHosts: ['github.com'],
          codeLanguage: 'typescript',
        },
        passPoints: 7,
        skills: ['problem-framing'],
        resubmission: 'until_approved',
        ...overrides,
      },
    },
    activities: [],
  };
}

function submissionSetup(
  assignmentGrading = grading(),
  history: unknown[] = [],
  assets: unknown[] = [],
  writes: { submission?: unknown; files?: unknown } = {},
) {
  return new SupabaseStub({
    enrollments: [successful({ course_version_id: 'version-1', status: 'active' })],
    course_version_items: [successful({ kind: 'assignment', grading: assignmentGrading })],
    assignment_submissions: [successful(history), successful(writes.submission ?? {
      id: 'submission-1', status: 'submitted', attempt_no: history.length + 1,
    })],
    media_assets: assets.length ? [successful(assets)] : [],
    submission_files: writes.files === undefined ? [] : [successful(writes.files)],
    'rpc:submit_assignment_guarded': [successful({
      ...(writes.submission as Record<string, unknown> | undefined ?? {
        id: 'submission-1', status: 'submitted', attempt_no: history.length + 1,
      }),
      created: true,
    })],
    'rpc:claim_assignment_submission': [successful(true)],
  });
}

function serviceFor(database: SupabaseStub) {
  const recompute = vi.fn().mockResolvedValue(undefined);
  const onAssignmentApproved = vi.fn().mockResolvedValue(undefined);
  const awardXp = vi.fn().mockResolvedValue(undefined);
  const writeAudit = vi.fn().mockResolvedValue(undefined);
  return {
    database,
    recompute,
    onAssignmentApproved,
    awardXp,
    writeAudit,
    service: createSubmissionsService({
      database,
      hooks: { recompute, onAssignmentApproved, awardXp },
      audit: writeAudit,
      now: () => new Date('2026-09-03T12:00:00.000Z'),
    }),
  };
}

function insertedRows(database: SupabaseStub, table: string, operation = 'insert') {
  return database.queries
    .filter((query) => query.table === table)
    .flatMap((query) => query.operations)
    .filter(([name]) => name === operation)
    .map(([, value]) => value);
}

function rpcArgs(database: SupabaseStub, name: string) {
  return database.rpcCalls.filter(([called]) => called === name).map(([, args]) => args);
}

describe('submission server composition', () => {
  it('recomputes progress through the real learning-core hook after a durable submission', async () => {
    const database = submissionSetup();
    mocks.supabaseService.mockReturnValue(database);
    mocks.recompute.mockResolvedValue(undefined);

    await expect(createServerSubmissionsService().submit(
      learner,
      'course-1',
      'assignment',
      undefined,
      { text: 'Completed response' },
    )).resolves.toMatchObject({ submissionId: 'submission-1', status: 'submitted' });

    expect(mocks.recompute).toHaveBeenCalledWith(learner, 'course-1');
  });
});

describe('assignment submission spec enforcement', () => {
  it('blocks assignment writes at an explicitly suspended trusted enrollment branch',async()=>{
    const database=submissionSetup();
    database.setResults('enrollments',[successful({course_version_id:'version-1',status:'active',branch_id:'school-a',branch_scope_known:true})]);
    const suspended:Actor={userId:'learner-1',roles:[],authorization:{source:'database',accountStatus:'active',memberships:[{branchId:'school-a',status:'suspended'}],assignments:[]}};
    await expect(serviceFor(database).service.submit(suspended,'course-1','assignment',undefined,{text:'blocked'})).rejects.toMatchObject({status:403,code:'MEMBERSHIP_SUSPENDED'});
    expect(database.queries.some(({table})=>table==='course_version_items')).toBe(false);
  });
  it('keeps historical assignment session reads available to the active-account owner',async()=>{
    const database=submissionSetup();
    database.setResults('enrollments',[successful({course_version_id:'version-1',status:'active',branch_id:'school-a',branch_scope_known:true})]);
    const suspended:Actor={userId:'learner-1',roles:[],authorization:{source:'database',accountStatus:'active',memberships:[{branchId:'school-a',status:'suspended'}],assignments:[]}};
    await expect(serviceFor(database).service.session(suspended,{courseId:'course-1',itemId:'assignment',blockId:null})).resolves.toMatchObject({attemptsUsed:0,submissions:[]});
    expect(database.queries.some(({table})=>table==='branch_memberships')).toBe(false);
  });
  const notebookConfig = {
    runtimeMode: 'jupyterlite' as const,
    templateAssetId: 'template-1', templateChecksum: 'a'.repeat(64),
    runtimeProfileId: 'python-data-v1' as const, runtimeProfileVersion: '1' as const,
    datasets: [],
  };
  const notebookPayload = {
    assetId: 'artifact-1', checksum: 'd'.repeat(64), format: 'ipynb' as const,
    templateChecksum: 'a'.repeat(64), runtimeProfileId: 'python-data-v1', runtimeProfileVersion: '1',
  };
  const notebookArtifact = {
    id: 'artifact-1', owner_id: 'learner-1', course_id: 'course-1', course_version_id: 'version-1', item_id: 'assignment', block_id: null,
    purpose: 'submission', status: 'ready', checksum: 'd'.repeat(64), template_asset_id: 'template-1', template_checksum: 'a'.repeat(64),
    runtime_profile_id: 'python-data-v1', runtime_profile_version: '1', size_bytes: 1024,
    mime: 'application/x-ipynb+json', filename: 'work.ipynb', storage_path: 'learner-1/work.ipynb',
  };

  it('parses the exact bounded notebook assignment payload', () => {
    expect(SubmissionPayloadSchema.parse({ notebook: notebookPayload })).toEqual({ notebook: notebookPayload });
    expect(SubmissionPayloadSchema.safeParse({ notebook: { ...notebookPayload, format: 'html' } }).success).toBe(false);
    expect(SubmissionPayloadSchema.safeParse({ notebook: { ...notebookPayload, role: 'admin' } }).success).toBe(false);
  });

  it('requires a ready server-bound notebook artifact and stores canonical provenance', async () => {
    const database = submissionSetup(grading({ notebook: notebookConfig }));
    database.setResults('notebook_artifacts', [successful(notebookArtifact)]);
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, { notebook: notebookPayload }))
      .resolves.toMatchObject({ submissionId: 'submission-1' });
    expect(rpcArgs(database, 'submit_assignment_guarded')).toContainEqual(expect.objectContaining({
      p_payload: { notebook: notebookPayload },
    }));
    expect(database.queries.find(({ table }) => table === 'notebook_artifacts')?.operations)
      .toContainEqual(['eq', 'id', 'artifact-1']);
  });

  it('rejects missing, foreign, and stale notebook artifacts before the guarded submission write', async () => {
    const missingDatabase = submissionSetup(grading({ notebook: notebookConfig }));
    const foreignDatabase = submissionSetup(grading({ notebook: notebookConfig }));
    foreignDatabase.setResults('notebook_artifacts', [successful({ ...notebookArtifact, owner_id: 'other' })]);

    await expect(serviceFor(missingDatabase).service.submit(
      learner, 'course-1', 'assignment', undefined, { text: 'No notebook' },
    )).rejects.toMatchObject({ status: 400, code: 'NOTEBOOK_REQUIRED' });
    await expect(serviceFor(foreignDatabase).service.submit(
      learner, 'course-1', 'assignment', undefined, { notebook: notebookPayload },
    )).rejects.toMatchObject({ status: 400, code: 'INVALID_NOTEBOOK_ARTIFACT' });
    expect(rpcArgs(foreignDatabase, 'submit_assignment_guarded')).toEqual([]);
  });

  it('rejects a notebook artifact on an ordinary assignment', async () => {
    const database = submissionSetup();
    await expect(serviceFor(database).service.submit(
      learner, 'course-1', 'assignment', undefined, { notebook: notebookPayload },
    )).rejects.toMatchObject({ status: 400, code: 'SUBMISSION_TYPE_NOT_ALLOWED' });
  });
  it('rejects more files than the compiled assignment allows', async () => {
    const database = submissionSetup();
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, {
      files: [
        { assetId: 'asset-1', name: 'one.pdf', size: 10, mime: 'application/pdf' },
        { assetId: 'asset-2', name: 'two.pdf', size: 10, mime: 'application/pdf' },
        { assetId: 'asset-3', name: 'three.pdf', size: 10, mime: 'application/pdf' },
      ],
    })).rejects.toMatchObject({ status: 400, code: 'TOO_MANY_FILES' });
    expect(insertedRows(database, 'assignment_submissions')).toEqual([]);
  });

  it('checks allowed MIME types against the stored asset instead of client metadata', async () => {
    const database = submissionSetup(grading(), [], [{
      id: 'asset-1', owner_id: 'learner-1', bucket: 'submissions', path: 'learner-1/file.exe',
      mime: 'application/x-msdownload', size_bytes: 10,
    }]);
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, {
      files: [{ assetId: 'asset-1', name: 'claim.pdf', size: 10, mime: 'application/pdf' }],
    })).rejects.toMatchObject({ status: 400, code: 'FILE_TYPE_NOT_ALLOWED' });
    expect(insertedRows(database, 'assignment_submissions')).toEqual([]);
  });

  it('checks the assignment size limit against canonical stored bytes', async () => {
    const database = submissionSetup(grading(), [], [{
      id: 'asset-1', owner_id: 'learner-1', bucket: 'submissions', path: 'learner-1/work.pdf',
      mime: 'application/pdf', size_bytes: 5 * 1024 * 1024 + 1,
    }]);
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, {
      files: [{ assetId: 'asset-1', name: 'work.pdf', size: 5 * 1024 * 1024 + 1, mime: 'application/pdf' }],
    })).rejects.toMatchObject({ status: 400, code: 'FILE_TOO_LARGE' });
  });

  it('rejects an HTTPS link outside the compiled host allowlist', async () => {
    const database = submissionSetup();
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, {
      links: [{ url: 'https://github.com.evil.example/work' }],
    })).rejects.toMatchObject({ status: 400, code: 'LINK_HOST_NOT_ALLOWED' });
    expect(insertedRows(database, 'assignment_submissions')).toEqual([]);
  });

  it('fails closed when the compiled link host allowlist is empty', async () => {
    const database = submissionSetup(grading({
      submission: { accepts: ['link'], linkHosts: [] },
    }));
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, {
      links: [{ url: 'https://github.com/vfuture/work' }],
    })).rejects.toMatchObject({ status: 400, code: 'LINK_HOST_NOT_ALLOWED' });
  });

  it('allows subdomains only when the allowlist entry is a registrable domain', async () => {
    const ordinary = submissionSetup(grading({
      submission: { accepts: ['link'], linkHosts: ['github.com'] },
    }));
    const publicSuffix = submissionSetup(grading({
      submission: { accepts: ['link'], linkHosts: ['github.io'] },
    }));
    const wildcardSuffix = submissionSetup(grading({
      submission: { accepts: ['link'], linkHosts: ['*.github.io'] },
    }));

    await expect(serviceFor(ordinary).service.submit(learner, 'course-1', 'assignment', undefined, {
      links: [{ url: 'https://docs.github.com/work' }],
    })).resolves.toMatchObject({ status: 'submitted' });
    await expect(serviceFor(publicSuffix).service.submit(learner, 'course-1', 'assignment', undefined, {
      links: [{ url: 'https://attacker.github.io/work' }],
    })).rejects.toMatchObject({ status: 400, code: 'LINK_HOST_NOT_ALLOWED' });
    await expect(serviceFor(wildcardSuffix).service.submit(learner, 'course-1', 'assignment', undefined, {
      links: [{ url: 'https://team.github.io/work' }],
    })).resolves.toMatchObject({ status: 'submitted' });
  });

  it('rejects a submission asset not owned by the learner in the submissions bucket', async () => {
    const database = submissionSetup(grading(), [], [{
      id: 'asset-1', owner_id: 'learner-2', bucket: 'submissions', path: 'learner-2/work.pdf',
      mime: 'application/pdf', size_bytes: 10,
    }]);
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, {
      files: [{ assetId: 'asset-1', name: 'work.pdf', size: 10, mime: 'application/pdf' }],
    })).rejects.toMatchObject({ status: 400, code: 'INVALID_SUBMISSION_FILE' });
    expect(insertedRows(database, 'assignment_submissions')).toEqual([]);
  });

  it('allows harmless consecutive dots inside an owned storage filename', async () => {
    const database = submissionSetup(grading(), [], [{
      id: 'asset-1', owner_id: 'learner-1', bucket: 'submissions', path: 'learner-1/project..final.pdf',
      mime: 'application/pdf', size_bytes: 10,
    }]);
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, {
      files: [{ assetId: 'asset-1', name: 'project..final.pdf', size: 10, mime: 'application/pdf' }],
    })).resolves.toMatchObject({ status: 'submitted' });
  });

  it('records canonical stored file metadata and recomputes learner progress', async () => {
    const database = submissionSetup(grading(), [], [{
      id: 'asset-1', owner_id: 'learner-1', bucket: 'submissions', path: 'learner-1/work.pdf',
      mime: 'application/pdf', size_bytes: 10,
    }], { files: [] });
    const { service, recompute } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, {
      text: 'My work',
      files: [{ assetId: 'asset-1', name: '../work.pdf', size: 10, mime: 'application/pdf' }],
    })).resolves.toEqual({ submissionId: 'submission-1', status: 'submitted', attemptNo: 1 });

    expect(rpcArgs(database, 'submit_assignment_guarded')).toEqual([expect.objectContaining({
      p_user_id: 'learner-1', p_course_id: 'course-1', p_course_version_id: 'version-1', p_item_id: 'assignment', p_block_id: null,
      p_expected_latest_submission_id: null, p_resubmission: 'until_approved', p_payload: { text: 'My work' },
      p_files: [{ asset_id: 'asset-1', name: 'work.pdf', size_bytes: 10, mime: 'application/pdf' }],
    })]);
    expect(insertedRows(database, 'assignment_submissions')).toEqual([]);
    expect(insertedRows(database, 'submission_files')).toEqual([]);
    expect(recompute).toHaveBeenCalledWith(learner, 'course-1');
  });

  it('does not turn a committed submission into a retry when recompute fails', async () => {
    const database = submissionSetup();
    const { service, recompute } = serviceFor(database);
    recompute.mockRejectedValue(new Error('progress unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, { text: 'My work' }))
      .resolves.toEqual({ submissionId: 'submission-1', status: 'submitted', attemptNo: 1 });
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[submission-effect:[0-9a-f-]+\]/),
      expect.objectContaining({ effect: 'progress.recompute', submissionId: 'submission-1' }),
    );
  });
});

describe('assignment upload authorization', () => {
  it('loads the enrolled assignment and returns its item scope before upload', async () => {
    const database = submissionSetup();
    const { service } = serviceFor(database);

    await expect(service.authorizeUpload(learner, 'course-1', 'assignment', undefined, {
      size: 1024,
      mime: 'application/pdf',
    })).resolves.toEqual({ courseVersionId: 'version-1', itemId: 'assignment' });
  });

  it('rejects upload bytes and MIME types outside the enrolled assignment spec', async () => {
    const oversized = serviceFor(submissionSetup()).service;
    const disallowed = serviceFor(submissionSetup()).service;

    await expect(oversized.authorizeUpload(learner, 'course-1', 'assignment', undefined, {
      size: 5 * 1024 * 1024 + 1,
      mime: 'application/pdf',
    })).rejects.toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
    await expect(disallowed.authorizeUpload(learner, 'course-1', 'assignment', undefined, {
      size: 1024,
      mime: 'application/zip',
    })).rejects.toMatchObject({ status: 415, code: 'FILE_TYPE_NOT_ALLOWED' });
  });

  it('rejects uploads without an active enrollment or a file submission channel', async () => {
    const notEnrolled = new SupabaseStub({ enrollments: [successful(null)] });
    const noFiles = submissionSetup(grading({
      submission: { accepts: ['text'] },
    }));

    await expect(serviceFor(notEnrolled).service.authorizeUpload(
      learner,
      'course-1',
      'assignment',
      undefined,
      { size: 1, mime: 'text/plain' },
    )).rejects.toMatchObject({ status: 403, code: 'NOT_ENROLLED' });
    await expect(serviceFor(noFiles).service.authorizeUpload(
      learner,
      'course-1',
      'assignment',
      undefined,
      { size: 1, mime: 'text/plain' },
    )).rejects.toMatchObject({ status: 400, code: 'SUBMISSION_TYPE_NOT_ALLOWED' });
  });
});

describe('assignment resubmission policy', () => {
  it('blocks every later attempt when resubmission is never', async () => {
    const database = submissionSetup(grading({ resubmission: 'never' }), [{ attempt_no: 1, status: 'changes_requested' }]);
    database.setResults('rpc:submit_assignment_guarded', [failed('RESUBMISSION_NOT_ALLOWED')]);
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, { text: 'again' }))
      .rejects.toMatchObject({ status: 409, code: 'RESUBMISSION_NOT_ALLOWED' });
  });

  it('allows exactly one requested revision under once', async () => {
    const database = submissionSetup(
      grading({ resubmission: 'once' }),
      [{ attempt_no: 1, status: 'changes_requested' }],
    );
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, { text: 'revision' }))
      .resolves.toEqual({ submissionId: 'submission-1', status: 'submitted', attemptNo: 2 });
  });

  it('blocks a third attempt under once', async () => {
    const database = submissionSetup(grading({ resubmission: 'once' }), [
      { attempt_no: 2, status: 'changes_requested' },
      { attempt_no: 1, status: 'changes_requested' },
    ]);
    database.setResults('rpc:submit_assignment_guarded', [failed('RESUBMISSION_NOT_ALLOWED')]);
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, { text: 'third' }))
      .rejects.toMatchObject({ status: 409, code: 'RESUBMISSION_NOT_ALLOWED' });
  });

  it('blocks until_approved submissions after any approved attempt', async () => {
    const database = submissionSetup(grading(), [
      { attempt_no: 2, status: 'approved' },
      { attempt_no: 1, status: 'changes_requested' },
    ]);
    database.setResults('rpc:submit_assignment_guarded', [failed('ASSIGNMENT_ALREADY_APPROVED')]);
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, { text: 'after approval' }))
      .rejects.toMatchObject({ status: 409, code: 'ASSIGNMENT_ALREADY_APPROVED' });
  });

  it('enforces a hard ceiling of 20 attempts even under until_approved', async () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      attempt_no: 20 - index,
      status: 'changes_requested',
    }));
    const database = submissionSetup(grading(), history);
    database.setResults('rpc:submit_assignment_guarded', [failed('ATTEMPT_LIMIT')]);
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, { text: 'attempt 21' }))
      .rejects.toMatchObject({ status: 409, code: 'ATTEMPT_LIMIT' });
    expect(rpcArgs(database, 'claim_assignment_submission')).toHaveLength(1);
    expect(rpcArgs(database, 'submit_assignment_guarded')).toHaveLength(1);
  });

  it('limits each learner to 10 submissions per assignment per hour', async () => {
    const database = submissionSetup();
    database.setResults('rpc:claim_assignment_submission', [successful(false)]);
    const { service } = serviceFor(database);

    await expect(service.submit(learner, 'course-1', 'assignment', undefined, { text: 'too frequent' }))
      .rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    expect(rpcArgs(database, 'claim_assignment_submission')).toEqual([expect.objectContaining({
      p_user_id: 'learner-1',
      p_course_version_id: 'version-1',
      p_item_id: 'assignment',
      p_block_id: null,
      p_limit: 10,
      p_window_seconds: 60 * 60,
    })]);
    expect(rpcArgs(database, 'submit_assignment_guarded')).toEqual([]);
  });
});

describe('guarded assignment lifecycle', () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'learner-1',
    course_version_id: 'version-1',
    item_id: 'assignment',
    block_id: null,
    attempt_no: 1,
    payload: { text: 'Same work' },
    status: 'submitted',
    submitted_at: '2026-09-03T12:00:00.000Z',
    submission_files: [],
    grades: [],
    ...overrides,
  });

  function guardedDatabase(rpcResult: Result, rows: unknown[] = [stored()]) {
    return new SupabaseStub({
      enrollments: [successful({ course_version_id: 'version-1', status: 'active' })],
      course_version_items: [successful({ kind: 'assignment', grading: grading() })],
      assignment_submissions: rows.length ? [successful(rows)] : [],
      'rpc:claim_assignment_submission': [successful(true)],
      'rpc:submit_assignment_guarded': [rpcResult],
    });
  }

  it('returns the existing canonical session for an identical replay without rerunning effects', async () => {
    const database = guardedDatabase(successful({
      id: '11111111-1111-4111-8111-111111111111', status: 'submitted', attempt_no: 1,
      submitted_at: '2026-09-03T12:00:00.000Z', created: false,
    }));
    const { service, recompute } = serviceFor(database);

    await expect(service.submit(
      learner,
      { courseId: 'course-1', itemId: 'assignment', blockId: null },
      '11111111-1111-4111-8111-111111111111',
      { text: 'Same work' },
    )).resolves.toMatchObject({
      created: false,
      session: {
        attemptsUsed: 1,
        submissions: [{ submissionId: '11111111-1111-4111-8111-111111111111' }],
        action: { allowed: true, kind: 'revision', nextAttemptNo: 2 },
      },
    });
    expect(recompute).not.toHaveBeenCalled();
  });

  it('maps a divergent stale revision to a stable conflict without post-commit effects', async () => {
    const database = guardedDatabase(failed('SUBMISSION_STALE'), []);
    const { service, recompute } = serviceFor(database);

    await expect(service.submit(
      learner,
      { courseId: 'course-1', itemId: 'assignment', blockId: null },
      '11111111-1111-4111-8111-111111111111',
      { text: 'Changed work' },
    )).rejects.toMatchObject({ status: 409, code: 'SUBMISSION_STALE' });
    expect(recompute).not.toHaveBeenCalled();
  });

  it('authorizes and filters an inline assignment by its explicit block identity', async () => {
    const inline = grading();
    inline.assignments!['inline-task'] = inline.assignments!.assignment;
    inline.rubrics['inline-task'] = inline.rubrics.assignment;
    delete inline.assignments!.assignment;
    delete inline.rubrics.assignment;
    const database = new SupabaseStub({
      enrollments: [successful({ course_version_id: 'version-1', status: 'active' })],
      course_version_items: [successful({ kind: 'lesson', grading: inline })],
      assignment_submissions: [successful([stored({
        item_id: 'lesson-1', block_id: 'inline-task', payload: { text: 'Inline work' },
      })])],
    });

    await expect(serviceFor(database).service.session(learner, {
      courseId: 'course-1', itemId: 'lesson-1', blockId: 'inline-task',
    })).resolves.toMatchObject({
      locator: { itemId: 'lesson-1', blockId: 'inline-task' },
      submissions: [{ payload: { text: 'Inline work' } }],
    });
    const query = database.queries.find(({ table }) => table === 'assignment_submissions');
    expect(query?.operations).toContainEqual(['eq', 'block_id', 'inline-task']);
  });

  it('keeps an inline block explicit even when its id equals the surrounding item id', async () => {
    const inline = grading();
    inline.assignments!['lesson-1'] = inline.assignments!.assignment;
    inline.rubrics['lesson-1'] = inline.rubrics.assignment;
    delete inline.assignments!.assignment;
    delete inline.rubrics.assignment;
    const database = new SupabaseStub({
      enrollments: [successful({ course_version_id: 'version-1', status: 'active' })],
      course_version_items: [successful({ kind: 'lesson', grading: inline })],
      assignment_submissions: [successful([stored({ item_id: 'lesson-1', block_id: 'lesson-1' })])],
    });

    await expect(serviceFor(database).service.session(learner, {
      courseId: 'course-1', itemId: 'lesson-1', blockId: 'lesson-1',
    })).resolves.toMatchObject({ locator: { itemId: 'lesson-1', blockId: 'lesson-1' } });
  });
});

describe('submission grading queue', () => {
  function queueRow(id: string, branchId: string): Record<string, unknown> {
    return {
      id,
      user_id: `learner-${id}`,
      course_version_id: 'version-1',
      item_id: 'assignment',
      block_id: null,
      attempt_no: 1,
      payload: { text: 'Work' },
      status: 'submitted',
      submitted_at: '2026-09-03T12:00:00.000Z',
      branch_id: branchId,
      branch_scope_known: true,
      profiles: { display_name: `Learner ${id}` },
      submission_files: [],
      grades: [],
    };
  }

  it('rejects a Vinsmc instructor asking for the Ans branch before querying submissions', async () => {
    const database = new SupabaseStub();
    const { service } = serviceFor(database);

    await expect(service.queue(instructor, { branchId: 'ans' }))
      .rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(database.queries).toEqual([]);
  });

  it('defaults a branch-scoped instructor to their branch and excludes other branch rows', async () => {
    const vinsmc = queueRow('submission-v', 'vinsmc');
    const ans = queueRow('submission-a', 'ans');
    const database = new SupabaseStub({ assignment_submissions: [successful([vinsmc, ans])] });
    const { service } = serviceFor(database);

    await expect(service.queue(instructor, {})).resolves.toMatchObject({
      items: [{ id: 'submission-v', branchId: 'vinsmc' }], nextCursor: null,
    });
    const queueQuery = database.queries.find(({ table }) => table === 'assignment_submissions');
    expect(queueQuery?.operations).toContainEqual(['eq', 'branch_id', 'vinsmc']);
    expect(queueQuery?.operations).toContainEqual(['eq', 'branch_scope_known', true]);
    expect(queueQuery?.operations.find(([name]) => name === 'select')?.[1]).toContain('profiles!inner');
  });

  it('bounds each submission queue page to 50 rows', async () => {
    const database = new SupabaseStub({ assignment_submissions: [successful([])] });
    const { service } = serviceFor(database);

    await service.queue(instructor, {});

    const queueQuery = database.queries.find(({ table }) => table === 'assignment_submissions');
    expect(queueQuery?.operations).toContainEqual(['limit', 51]);
  });

  it('returns a stable keyset cursor and applies assignment identity on continuation', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => queueRow(
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      'vinsmc',
    ));
    const firstDatabase = new SupabaseStub({ assignment_submissions: [successful(rows)] });
    const first = await serviceFor(firstDatabase).service.queue(instructor, { assignmentId: 'assignment' });

    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    const firstQuery = firstDatabase.queries.find(({ table }) => table === 'assignment_submissions');
    expect(firstQuery?.operations).toContainEqual([
      'or', 'block_id.eq.assignment,and(block_id.is.null,item_id.eq.assignment)',
    ]);

    const nextDatabase = new SupabaseStub({ assignment_submissions: [successful([rows[50]])] });
    const next = await serviceFor(nextDatabase).service.queue(instructor, {
      assignmentId: 'assignment', cursor: first.nextCursor!,
    });
    expect(next.items).toHaveLength(1);
    const nextQuery = nextDatabase.queries.find(({ table }) => table === 'assignment_submissions');
    expect(nextQuery?.operations.filter(([operation]) => operation === 'or')).toHaveLength(2);
  });

  it.each(['approved', 'changes_requested'] as const)(
    'projects a legacy unreleased %s decision as in review',
    async (decision) => {
      const row = queueRow(`submission-${decision}`, 'vinsmc');
      row.status = decision;
      row.grades = [{
        rubric_scores: {}, total_points: 0, max_points: 10, feedback: 'Private draft',
        decision, passed: false, graded_at: '2026-09-03T12:30:00.000Z', released: false,
      }];
      const database = new SupabaseStub({ assignment_submissions: [successful([row])] });

      await expect(serviceFor(database).service.queue(instructor, { status: 'in_review' }))
        .resolves.toMatchObject({ items: [{ id: row.id, status: 'in_review', grade: { released: false } }] });
      const query = database.queries.find(({ table }) => table === 'assignment_submissions');
      expect(query?.operations).not.toContainEqual(['eq', 'status', 'in_review']);
    },
  );

  it('excludes legacy unreleased approvals from the approved queue filter', async () => {
    const draft = queueRow('submission-draft', 'vinsmc');
    draft.status = 'approved';
    draft.grades = [{
      rubric_scores: {}, total_points: 0, max_points: 10, feedback: 'Private draft',
      decision: 'approved', passed: false, graded_at: '2026-09-03T12:30:00.000Z', released: false,
    }];
    const released = queueRow('submission-released', 'vinsmc');
    released.status = 'approved';
    released.grades = [{
      rubric_scores: {}, total_points: 10, max_points: 10, feedback: 'Released',
      decision: 'approved', passed: true, graded_at: '2026-09-03T12:30:00.000Z', released: true,
    }];
    const database = new SupabaseStub({ assignment_submissions: [successful([draft, released])] });

    await expect(serviceFor(database).service.queue(instructor, { status: 'approved' }))
      .resolves.toMatchObject({ items: [{ id: 'submission-released', status: 'approved' }] });
  });

  it('does not present a latest pending revision after the exact locator already earned released approval', async () => {
    const pending = queueRow('submission-new', 'vinsmc');
    pending.attempt_no = 2;
    const database = new SupabaseStub({
      assignment_submissions: [successful([pending]), successful([{
        user_id: 'learner-submission-new', course_version_id: 'version-1',
        item_id: 'assignment', block_id: null,
      }])],
    });

    await expect(serviceFor(database).service.queue(instructor, { status: 'in_review' }))
      .resolves.toMatchObject({ items: [] });
    const approvalQuery = database.queries.filter(({ table }) => table === 'assignment_submissions')[1];
    expect(approvalQuery?.operations).toEqual(expect.arrayContaining([
      ['eq', 'grades.released', true],
      ['eq', 'grades.decision', 'approved'],
      ['or', 'and(user_id.eq.learner-submission-new,course_version_id.eq.version-1,item_id.eq.assignment,block_id.is.null)'],
    ]));
  });

  it.each(['submitted', 'approved', 'changes_requested'] as const)(
    'filters the stored %s status in the database before paging',
    async (status) => {
      const database = new SupabaseStub({ assignment_submissions: [successful([])] });
      await serviceFor(database).service.queue(instructor, { status });
      const query = database.queries.find(({ table }) => table === 'assignment_submissions');
      expect(query?.operations).toContainEqual(['eq', 'status', status]);
    },
  );

  it('keeps the derived in_review filter out of the database query', async () => {
    const database = new SupabaseStub({ assignment_submissions: [successful([])] });
    await serviceFor(database).service.queue(instructor, { status: 'in_review' });
    const query = database.queries.find(({ table }) => table === 'assignment_submissions');
    expect(query?.operations.filter(([operation, column]) => (operation === 'eq' || operation === 'in') && column === 'status')).toEqual([]);
  });

  it('narrows the pending filter to stored waiting statuses in the database', async () => {
    const database = new SupabaseStub({ assignment_submissions: [successful([])] });
    await serviceFor(database).service.queue(instructor, { status: 'pending' });
    const query = database.queries.find(({ table }) => table === 'assignment_submissions');
    // Released rows never reach the scan, so a mature queue does not come back empty.
    expect(query?.operations).toContainEqual(['in', 'status', ['submitted', 'in_review']]);
    expect(query?.operations.filter(([operation, column]) => operation === 'eq' && column === 'status')).toEqual([]);
  });

  it('treats the pending filter as every submission still waiting on a grader', async () => {
    const waiting = queueRow('submission-waiting', 'vinsmc');
    const drafted = queueRow('submission-drafted', 'vinsmc');
    drafted.grades = [{
      rubric_scores: {}, total_points: 0, max_points: 10, feedback: 'Private draft',
      decision: 'approved', passed: false, graded_at: '2026-09-03T12:30:00.000Z', released: false,
    }];
    const done = queueRow('submission-done', 'vinsmc');
    done.status = 'approved';
    done.grades = [{
      rubric_scores: {}, total_points: 10, max_points: 10, feedback: 'Released',
      decision: 'approved', passed: true, graded_at: '2026-09-03T12:30:00.000Z', released: true,
    }];
    const database = new SupabaseStub({ assignment_submissions: [successful([waiting, drafted, done]), successful([])] });

    await expect(serviceFor(database).service.queue(instructor, { status: 'pending' })).resolves.toEqual({
      items: [
        expect.objectContaining({ id: 'submission-waiting', status: 'submitted' }),
        expect.objectContaining({ id: 'submission-drafted', status: 'in_review' }),
      ],
      nextCursor: null,
    });
  });

  it('fills a derived-status page from later database pages instead of returning a short page', async () => {
    const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const submittedAt = (index: number) => `2026-09-03T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`;
    const row = (index: number, inReview: boolean) => {
      const value = queueRow(id(index), 'vinsmc');
      value.submitted_at = submittedAt(index);
      if (inReview) {
        value.grades = [{
          rubric_scores: {}, total_points: 0, max_points: 10, feedback: 'Draft',
          decision: 'approved', passed: false, graded_at: '2026-09-03T13:00:00.000Z', released: false,
        }];
      }
      return value;
    };
    // First page: 51 rows, only rows 1..10 are in review. Second page: 51 rows, all in review.
    const first = Array.from({ length: 51 }, (_, index) => row(index + 1, index < 10));
    const second = Array.from({ length: 51 }, (_, index) => row(index + 51, true));
    // Each read is followed by the released-approval lookup for its waiting rows (none approved).
    const database = new SupabaseStub({ assignment_submissions: [successful(first), successful([]), successful(second), successful([])] });

    const page = await serviceFor(database).service.queue(instructor, { status: 'in_review' });

    expect(page.items).toHaveLength(50);
    expect(page.items[0]?.id).toBe(id(1));
    expect(page.items[9]?.id).toBe(id(10));
    expect(page.items[10]?.id).toBe(id(51));
    expect(page.items[49]?.id).toBe(id(90));
    const reads = database.queries.filter(({ table, operations }) => table === 'assignment_submissions'
      && operations.some(([operation]) => operation === 'limit'));
    expect(reads).toHaveLength(2);
    // The second read continues after the last row the first read scanned.
    expect(reads[1]?.operations).toContainEqual([
      'or', `submitted_at.gt.${submittedAt(50)},and(submitted_at.eq.${submittedAt(50)},id.gt.${id(50)})`,
    ]);
    // Trimmed to 50 items, the cursor resumes after the last returned item.
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'))).toEqual({
      submittedAt: submittedAt(90), id: id(90),
    });
  });

  it('stops filling after four database pages and returns a continuation cursor', async () => {
    const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const submittedAt = (index: number) => `2026-09-03T${String(10 + Math.floor(index / 3600)).padStart(2, '0')}:${String(Math.floor((index % 3600) / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`;
    const pageOf = (start: number) => Array.from({ length: 51 }, (_, index) => {
      const value = queueRow(id(start + index), 'vinsmc');
      value.submitted_at = submittedAt(start + index);
      return value;
    });
    const database = new SupabaseStub({
      assignment_submissions: [1, 51, 101, 151, 201].flatMap((start) => [successful(pageOf(start)), successful([])]),
    });

    const page = await serviceFor(database).service.queue(instructor, { status: 'in_review' });

    expect(page.items).toEqual([]);
    const reads = database.queries.filter(({ table, operations }) => table === 'assignment_submissions'
      && operations.some(([operation]) => operation === 'limit'));
    expect(reads).toHaveLength(4);
    expect(JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'))).toEqual({
      submittedAt: submittedAt(200), id: id(200),
    });
  });

  it('rejects malformed queue cursors before reading submissions', async () => {
    const database = new SupabaseStub();
    await expect(serviceFor(database).service.queue(instructor, { cursor: 'not-json' }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    expect(database.queries).toEqual([]);
  });

  it('rejects an unsafe assignment filter before building the PostgREST expression', async () => {
    const database = new SupabaseStub();
    await expect(serviceFor(database).service.queue(instructor, { assignmentId: 'task,or(status.eq.approved)' }))
      .rejects.toMatchObject({ name: 'ZodError' });
    expect(database.queries).toEqual([]);
  });

  it('filters an unscoped queue to the intersection of all actor branches', async () => {
    const multiBranchInstructor: Actor = {
      userId: 'instructor-multi',
      roles: [
        { role: 'instructor', branchId: 'vinsmc' },
        { role: 'instructor', branchId: 'ans' },
      ],
    };
    const vinsmc = queueRow('submission-v', 'vinsmc');
    const ans = queueRow('submission-a', 'ans');
    const other = queueRow('submission-x', 'other');
    const database = new SupabaseStub({ assignment_submissions: [successful([vinsmc, ans, other])] });
    const { service } = serviceFor(database);

    await expect(service.queue(multiBranchInstructor, {})).resolves.toMatchObject({
      items: [{ id: 'submission-v' }, { id: 'submission-a' }], nextCursor: null,
    });
    const queueQuery = database.queries.find(({ table }) => table === 'assignment_submissions');
    expect(queueQuery?.operations).toContainEqual(['in', 'branch_id', ['ans', 'vinsmc']]);
  });
});

describe('learner submission history', () => {
  function historyRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'submission-1', user_id: 'learner-1', course_version_id: 'version-1',
      item_id: 'assignment', block_id: null, attempt_no: 1, payload: { text: 'Work' },
      status: 'submitted', submitted_at: '2026-09-03T10:00:00.000Z',
      submission_files: [], grades: [], ...overrides,
    };
  }

  it('pins history to the enrolled version and exact block while masking grading drafts', async () => {
    const database = new SupabaseStub({
      enrollments: [successful({ course_version_id: 'version-1', status: 'active' })],
      course_version_items: [successful({ kind: 'assignment', grading: grading() })],
      assignment_submissions: [successful([{
        ...historyRow({
          id: 'submission-2', attempt_no: 2, status: 'approved',
          submitted_at: '2026-09-03T11:00:00.000Z',
          grades: [{
            rubric_scores: { quality: 4 }, total_points: 4, max_points: 10,
            feedback: 'hidden', decision: 'approved', passed: false,
            graded_at: '2026-09-03T12:00:00.000Z', released: false,
          }],
        }),
      }, historyRow({
        grades: [{
          rubric_scores: { quality: 2 }, total_points: 2, max_points: 10,
          feedback: 'visible', decision: 'changes_requested', passed: false,
          graded_at: '2026-09-03T10:30:00.000Z', released: true,
        }],
        status: 'changes_requested',
      })])],
    });
    const { service } = serviceFor(database);

    const result = await service.session(learner, {
      courseId: 'course-1', itemId: 'assignment', blockId: null,
    });
    expect(result).toMatchObject({
      courseVersionId: 'version-1',
      attemptsUsed: 2,
      submissions: [
        { submissionId: 'submission-2', status: 'in_review' },
        { submissionId: 'submission-1', status: 'changes_requested', grade: { feedback: 'visible', released: true } },
      ],
      action: {
        allowed: true, kind: 'revision', expectedLatestSubmissionId: 'submission-2', nextAttemptNo: 3,
      },
    });
    expect(result.submissions[0]).not.toHaveProperty('grade');
    const historyQuery = database.queries.find(({ table }) => table === 'assignment_submissions');
    expect(historyQuery?.operations).toContainEqual(['eq', 'course_version_id', 'version-1']);
    expect(historyQuery?.operations).toContainEqual(['is', 'block_id', null]);
  });

  it('allows once revision only after released changes requested and blocks unreleased decisions', async () => {
    const releasedDatabase = new SupabaseStub({
      enrollments: [successful({ course_version_id: 'version-1', status: 'active' })],
      course_version_items: [successful({ kind: 'assignment', grading: grading({ resubmission: 'once' }) })],
      assignment_submissions: [successful([historyRow({
        status: 'changes_requested', grades: [{
          rubric_scores: {}, total_points: 0, max_points: 10, feedback: 'revise',
          decision: 'changes_requested', passed: false, graded_at: '2026-09-03T11:00:00.000Z', released: true,
        }],
      })])],
    });
    const draftDatabase = new SupabaseStub({
      enrollments: [successful({ course_version_id: 'version-1', status: 'active' })],
      course_version_items: [successful({ kind: 'assignment', grading: grading({ resubmission: 'once' }) })],
      assignment_submissions: [successful([historyRow({
        status: 'changes_requested', grades: [{
          rubric_scores: {}, total_points: 0, max_points: 10, feedback: 'hidden',
          decision: 'changes_requested', passed: false, graded_at: '2026-09-03T11:00:00.000Z', released: false,
        }],
      })])],
    });

    await expect(serviceFor(releasedDatabase).service.session(learner, {
      courseId: 'course-1', itemId: 'assignment', blockId: null,
    })).resolves.toMatchObject({ action: { allowed: true, kind: 'revision' } });
    const draftResult = await serviceFor(draftDatabase).service.session(learner, {
      courseId: 'course-1', itemId: 'assignment', blockId: null,
    });
    expect(draftResult).toMatchObject({
      submissions: [{ status: 'in_review' }],
      action: { allowed: false, reason: 'awaiting_review' },
    });
    expect(draftResult.submissions[0]).not.toHaveProperty('grade');
  });
});

describe('grading', () => {
  function durableGrade(
    decision: 'approved' | 'changes_requested' = 'approved',
    released = true,
    rubricScores: Record<string, number> = { quality: 3, impact: 4 },
    passed = true,
  ) {
    return {
      rubric_scores: rubricScores,
      total_points: Object.values(rubricScores).reduce((sum, value) => sum + value, 0),
      max_points: 10,
      feedback: 'Durable feedback',
      decision,
      passed,
      graded_at: '2026-09-03T12:00:00.000Z',
      released,
    };
  }

  function gradingDatabase(
    existingGrade: unknown = null,
    assignmentGrading = grading(),
    submissionStatus: 'submitted' | 'approved' = 'submitted',
    refreshedGrade = durableGrade(),
    refreshedResult?: Result,
  ) {
    const refreshedStatus = refreshedGrade.released ? refreshedGrade.decision : 'in_review';
    return new SupabaseStub({
      assignment_submissions: [
        successful({
          id: 'submission-1', user_id: 'learner-1', course_version_id: 'version-1',
          item_id: 'assignment', block_id: null, attempt_no: 1, status: submissionStatus,
          submitted_at: '2026-09-03T11:00:00.000Z', payload: { text: 'Work' },
          branch_id: 'vinsmc', branch_scope_known: true,
          profiles: { display_name: 'Learner' }, submission_files: [],
          grades: existingGrade ? [existingGrade] : [],
        }),
        refreshedResult ?? successful({
          id: 'submission-1', user_id: 'learner-1', course_version_id: 'version-1',
          item_id: 'assignment', block_id: null, attempt_no: 1, status: refreshedStatus,
          submitted_at: '2026-09-03T11:00:00.000Z', payload: { text: 'Work' },
          branch_id: 'vinsmc', branch_scope_known: true,
          profiles: { display_name: 'Learner' }, submission_files: [],
          grades: [refreshedGrade],
        }),
      ],
      course_version_items: [successful({ grading: assignmentGrading })],
      course_versions: [successful({ course_id: 'course-1' })],
      grades: [successful(existingGrade), successful({ id: 'grade-1' })],
      'rpc:grade_assignment_submission_guarded': [successful({
        id: 'submission-1', status: refreshedStatus,
        became_released_approved: refreshedGrade.released && refreshedGrade.decision === 'approved',
      })],
    });
  }

  it('rejects a rubric score above its criterion maximum before writing a grade', async () => {
    const database = gradingDatabase();
    const { service } = serviceFor(database);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 5, impact: 1 },
      feedback: { en: 'Review' },
      decision: 'changes_requested',
      release: false,
    })).rejects.toMatchObject({ status: 400, code: 'RUBRIC_SCORE_OUT_OF_RANGE' });
    expect(rpcArgs(database, 'grade_assignment_submission_guarded')).toEqual([]);
  });

  it('saves a partial rubric as a grading draft', async () => {
    // A grader must be able to stop half way. Nothing partial reaches the learner,
    // because only a released grade is projected, so a draft needs no completeness.
    const database = gradingDatabase(null, grading(), 'submitted', durableGrade('approved', false, { quality: 3 }, false));
    const { service, recompute } = serviceFor(database);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 3 },
      feedback: 'Half reviewed',
      decision: 'approved',
      release: false,
    })).resolves.toMatchObject({ submission: { status: 'in_review', grade: { released: false } } });
    expect(rpcArgs(database, 'grade_assignment_submission_guarded')).toEqual([expect.objectContaining({
      p_released: false, p_rubric_scores: { quality: 3 },
    })]);
    expect(recompute).not.toHaveBeenCalled();
  });

  it('refuses to complete grading while a rubric criterion has no score', async () => {
    // Completion publishes a total, so an unscored criterion silently counting as
    // zero would misreport the result. Nothing is written.
    const database = gradingDatabase();
    const { service } = serviceFor(database);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 3 },
      feedback: 'Publishing early',
      decision: 'approved',
      release: true,
    })).rejects.toMatchObject({ status: 409, code: 'RUBRIC_INCOMPLETE' });
    expect(rpcArgs(database, 'grade_assignment_submission_guarded')).toEqual([]);
  });

  it('accepts an explicit zero as a scored criterion when completing grading', async () => {
    // Zero is a score. Only an absent criterion blocks completion.
    const database = gradingDatabase(
      null, grading(), 'submitted', durableGrade('approved', true, { quality: 0, impact: 0 }, false),
    );
    const { service } = serviceFor(database);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 0, impact: 0 },
      feedback: 'Nothing met the bar',
      decision: 'approved',
      release: true,
    })).resolves.toMatchObject({ submission: { grade: { released: true, totalPoints: 0 } } });
    expect(rpcArgs(database, 'grade_assignment_submission_guarded')).toEqual([expect.objectContaining({
      p_released: true, p_total_points: 0,
    })]);
  });

  it('rejects a grader whose branch does not match the learner', async () => {
    const database = gradingDatabase();
    const ansInstructor: Actor = {
      userId: 'instructor-ans', roles: [{ role: 'instructor', branchId: 'ans' }],
    };
    const { service } = serviceFor(database);

    await expect(service.grade(ansInstructor, 'submission-1', {
      rubricScores: { quality: 4, impact: 6 }, feedback: 'No access', decision: 'approved', release: true,
    })).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(rpcArgs(database, 'grade_assignment_submission_guarded')).toEqual([]);
  });

  it('maps grading an older attempt to a stable stale conflict without effects', async () => {
    const database = gradingDatabase();
    database.setResults('rpc:grade_assignment_submission_guarded', [failed('STALE_SUBMISSION')]);
    const { service, recompute, onAssignmentApproved, awardXp } = serviceFor(database);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 3, impact: 4 },
      feedback: 'Outdated review',
      decision: 'approved',
      release: true,
    })).rejects.toMatchObject({ status: 409, code: 'STALE_SUBMISSION' });
    expect(recompute).not.toHaveBeenCalled();
    expect(onAssignmentApproved).not.toHaveBeenCalled();
    expect(awardXp).not.toHaveBeenCalled();
  });

  it('keeps an unreleased approval as a private grading draft without final effects', async () => {
    const database = gradingDatabase(null, grading(), 'submitted', durableGrade('approved', false));
    const { service, recompute, onAssignmentApproved, awardXp } = serviceFor(database);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 4, impact: 6 },
      feedback: 'Not released yet',
      decision: 'approved',
      release: false,
    })).resolves.toMatchObject({ submission: { status: 'in_review', grade: { decision: 'approved', released: false } } });
    expect(rpcArgs(database, 'grade_assignment_submission_guarded')).toEqual([expect.objectContaining({
      p_decision: 'approved', p_released: false,
    })]);
    expect(recompute).not.toHaveBeenCalled();
    expect(onAssignmentApproved).not.toHaveBeenCalled();
    expect(awardXp).not.toHaveBeenCalled();
  });

  it.each([
    ['zero points', { quality: 0, impact: 0 }, grading(), false],
    ['full points', { quality: 4, impact: 6 }, grading(), true],
    ['a zero pass threshold', { quality: 0, impact: 0 }, grading({ passPoints: 0 }), true],
  ])('keeps changes_requested authoritative for %s while deriving only passed', async (
    _label,
    rubricScores,
    assignmentGrading,
    passed,
  ) => {
    const database = gradingDatabase(
      null,
      assignmentGrading,
      'submitted',
      durableGrade('changes_requested', true, rubricScores, passed),
    );
    const { service, recompute, onAssignmentApproved, awardXp } = serviceFor(database);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores,
      feedback: { en: 'Please revise' },
      decision: 'changes_requested',
      release: true,
    })).resolves.toMatchObject({
      submission: { status: 'changes_requested', grade: { decision: 'changes_requested', passed, released: true } },
    });
    expect(rpcArgs(database, 'grade_assignment_submission_guarded')).toEqual([expect.objectContaining({
      p_decision: 'changes_requested', p_passed: passed,
    })]);
    expect(recompute).not.toHaveBeenCalled();
    expect(onAssignmentApproved).not.toHaveBeenCalled();
    expect(awardXp).not.toHaveBeenCalled();
  });

  it('keeps an explicit approval authoritative even below passPoints', async () => {
    const database = gradingDatabase();
    const { service } = serviceFor(database);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 0, impact: 0 },
      feedback: 'Approved after review',
      decision: 'approved',
      release: true,
    })).resolves.toMatchObject({ submission: { status: 'approved' } });
  });

  it('totals rubric scores, records passed, recomputes for the learner, and audits with the Actor', async () => {
    const database = gradingDatabase();
    const { service, recompute, onAssignmentApproved, writeAudit } = serviceFor(database);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 3, impact: 4 },
      feedback: { en: 'Meets the bar' },
      decision: 'approved',
      release: true,
    })).resolves.toMatchObject({
      submission: { id: 'submission-1', status: 'approved', grade: { totalPoints: 7, decision: 'approved', released: true } },
    });

    expect(rpcArgs(database, 'grade_assignment_submission_guarded')).toEqual([expect.objectContaining({
      p_submission_id: 'submission-1', p_user_id: 'learner-1', p_course_id: 'course-1', p_grader_id: 'instructor-1',
      p_rubric_scores: { quality: 3, impact: 4 }, p_total_points: 7, p_max_points: 10,
      p_decision: 'approved', p_passed: true, p_released: true,
      p_audit_before: expect.objectContaining({ status: 'submitted', grade: null }),
      p_audit_after: expect.objectContaining({ status: 'approved', totalPoints: 7 }),
    })]);
    expect(insertedRows(database, 'grades', 'upsert')).toEqual([]);
    expect(recompute).toHaveBeenCalledWith({ userId: 'learner-1', roles: [] }, 'course-1');
    expect(onAssignmentApproved).toHaveBeenCalledWith({
      userId: 'learner-1',
      submissionId: 'submission-1',
      skills: ['problem-framing'],
    });
    expect(writeAudit).toHaveBeenCalledWith(
      instructor,
      'submission.grade',
      { type: 'assignment_submission', id: 'submission-1' },
      expect.objectContaining({ status: 'submitted', grade: null }),
      expect.objectContaining({ status: 'approved', totalPoints: 7, maxPoints: 10, released: true }),
    );
  });

  it('redacts and bounds the transactional SQL audit snapshots', async () => {
    const sensitiveGrading = grading();
    sensitiveGrading.rubrics.assignment.criteria[0].id = 'access-token';
    const database = gradingDatabase(null, sensitiveGrading);
    const { service } = serviceFor(database);

    await service.grade(instructor, 'submission-1', {
      rubricScores: { 'access-token': 4, impact: 6 },
      feedback: { vi: 'x'.repeat(20_000), en: 'y'.repeat(20_000) },
      decision: 'approved',
      release: true,
    });

    const auditAfter = rpcArgs(database, 'grade_assignment_submission_guarded')[0].p_audit_after;
    expect(auditAfter).toMatchObject({ rubricScores: { 'access-token': '[REDACTED]', impact: 6 } });
    expect(Buffer.byteLength(JSON.stringify(auditAfter))).toBeLessThanOrEqual(64 * 1024);
  });

  it('truncates oversized local submission audit snapshots to the audit-log bound', () => {
    const snapshot = submissionAuditSnapshot({ manifest: 'long prose '.repeat(10_000) });

    expect(snapshot).toMatchObject({ truncated: true, bytes: expect.any(Number) });
    expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(64 * 1024);
  });

  it('refuses to overwrite an approved submission grade after release', async () => {
    const existing = { decision: 'approved', released: true, feedback: 'Already final' };
    const database = gradingDatabase(existing, grading(), 'approved');
    const { service } = serviceFor(database);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 0, impact: 0 },
      feedback: 'Replacement',
      decision: 'changes_requested',
      release: false,
    })).rejects.toMatchObject({ status: 409, code: 'GRADE_RELEASED' });
    expect(rpcArgs(database, 'grade_assignment_submission_guarded')).toEqual([]);
  });

  it('attempts every post-commit effect without making a durable grade look failed', async () => {
    const database = gradingDatabase();
    const { service, recompute, onAssignmentApproved, writeAudit } = serviceFor(database);
    writeAudit.mockRejectedValue(new Error('audit unavailable'));
    recompute.mockRejectedValue(new Error('progress unavailable'));
    onAssignmentApproved.mockRejectedValue(new Error('skills unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 3, impact: 4 },
      feedback: 'Good',
      decision: 'approved',
      release: true,
    })).resolves.toMatchObject({ submission: { status: 'approved', grade: { totalPoints: 7 } } });
    expect(writeAudit).toHaveBeenCalledOnce();
    expect(recompute).toHaveBeenCalledOnce();
    expect(onAssignmentApproved).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('keeps an approved grade successful when the XP hook fails', async () => {
    const database = gradingDatabase();
    const { service, awardXp } = serviceFor(database);
    awardXp.mockRejectedValue(new Error('xp unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(service.grade(instructor, 'submission-1', {
        rubricScores: { quality: 3, impact: 4 },
        feedback: 'Good',
        decision: 'approved',
        release: true,
      })).resolves.toMatchObject({ submission: { status: 'approved', grade: { totalPoints: 7 } } });
      expect(awardXp).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'learner-1',
        courseVersionId: 'version-1',
        itemId: 'assignment',
        assignmentId: 'assignment',
      }));
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/^\[submission-effect:[0-9a-f-]+\]/),
        expect.objectContaining({ effect: 'xp.assignment_approved', submissionId: 'submission-1' }),
      );
    } finally {
      log.mockRestore();
    }
  });

  it('returns the committed grade shape when the post-commit refresh is unavailable', async () => {
    const database = gradingDatabase(
      null,
      grading(),
      'submitted',
      durableGrade(),
      failed('read unavailable', '08006'),
    );
    const { service } = serviceFor(database);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.grade(instructor, 'submission-1', {
      rubricScores: { quality: 3, impact: 4 },
      feedback: 'Committed feedback',
      decision: 'approved',
      release: true,
    })).resolves.toMatchObject({
      submission: {
        id: 'submission-1', status: 'approved',
        grade: { feedback: 'Committed feedback', released: true, totalPoints: 7 },
      },
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[submission-refresh:[0-9a-f-]+\]/),
      expect.objectContaining({ submissionId: 'submission-1' }),
    );
  });
});
