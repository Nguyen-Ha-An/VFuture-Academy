import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  getActor: vi.fn(),
  requirePermission: vi.fn(),
  supabaseService: vi.fn(),
  disableTypes: vi.fn(),
  imageSize: vi.fn(),
  submit: vi.fn(),
  session: vi.fn(),
  listMine: vi.fn(),
  queue: vi.fn(),
  grade: vi.fn(),
  authorizeUpload: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth', () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock('@/lib/permissions', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/permissions')>(),
  getActor: mocks.getActor,
  requirePermission: mocks.requirePermission,
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));
vi.mock('image-size', () => ({ disableTypes: mocks.disableTypes, imageSize: mocks.imageSize }));
vi.mock('@/features/submissions/service', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/features/submissions/service')>(),
  submit: mocks.submit,
  session: mocks.session,
  listMine: mocks.listMine,
  queue: mocks.queue,
  grade: mocks.grade,
  authorizeAssignmentUpload: mocks.authorizeUpload,
}));

import { GET as mine } from '@/app/api/v1/assignments/[itemId]/submissions/route';
import { POST as submitAssignment } from '@/app/api/v1/assignments/submit/route';
import { GET as queueSubmissions } from '@/app/api/v1/studio/submissions/route';
import { POST as gradeSubmission } from '@/app/api/v1/studio/submissions/[id]/grade/route';
import { POST as upload } from '@/app/api/v1/uploads/route';
import { MAX_MEDIA_BYTES } from '@/features/media/upload';
import { ApiError } from '@/lib/api';

const learner = { id: 'learner-1' };
const learnerActor = { userId: 'learner-1', roles: [] };
const instructor = {
  userId: 'instructor-1',
  roles: [{ role: 'instructor' as const, branchId: 'vinsmc' }],
};

function jsonRequest(url: string, body: unknown, method = 'POST', headers: Record<string,string> = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function uploadRequest(file: File, fields: { courseId?: string | null; itemId?: string | null; blockId?: string; purpose?: string } = {}) {
  const form = new FormData();
  form.set('file', file);
  if (fields.courseId !== null) form.set('courseId', fields.courseId ?? 'course-1');
  if (fields.itemId !== null) form.set('itemId', fields.itemId ?? 'assignment');
  if (fields.blockId) form.set('blockId', fields.blockId);
  if (fields.purpose) form.set('purpose', fields.purpose);
  return new Request('http://localhost/api/v1/uploads', {
    method: 'POST',
    headers: { 'Content-Length': String(file.size + 1_024) },
    body: form,
  });
}

function chunkedUploadRequest(file: File) {
  const form = new FormData();
  form.set('courseId', 'course-1');
  form.set('itemId', 'assignment');
  form.set('file', file);
  return new Request('http://localhost/api/v1/uploads', { method: 'POST', body: form });
}

describe('assignment API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue(learner);
    mocks.getActor.mockResolvedValue(instructor);
    mocks.requirePermission.mockResolvedValue(instructor);
    mocks.submit.mockResolvedValue({ created: true, session: { attemptsUsed: 1 } });
    mocks.session.mockResolvedValue({ attemptsUsed: 1, submissions: [] });
    mocks.listMine.mockResolvedValue([{ id: 'submission-1' }]);
    mocks.queue.mockResolvedValue([{ id: 'submission-1' }]);
    mocks.grade.mockResolvedValue({ submissionId: 'submission-1', status: 'approved' });
    mocks.authorizeUpload.mockResolvedValue({ courseVersionId: 'version-1', itemId: 'assignment' });
  });

  it('validates and submits a learner assignment as the authenticated user', async () => {
    const payload = { links: [{ url: 'https://github.com/vfuture/work' }] };
    const response = await submitAssignment(jsonRequest('http://localhost/api/v1/assignments/submit', {
      courseId: 'course-1', itemId: 'assignment', payload,
    }));

    expect(response.status).toBe(200);
    expect(mocks.requireApiUser).toHaveBeenCalledOnce();
    expect(mocks.getActor).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledWith(
      learnerActor,
      { courseId: 'course-1', itemId: 'assignment', blockId: null },
      null,
      payload,
    );
  });

  it('rejects an invalid submission body before calling the service', async () => {
    const response = await submitAssignment(jsonRequest('http://localhost/api/v1/assignments/submit', {
      courseId: 'course-1', itemId: 'assignment', payload: {}, unexpected: true,
    }));

    expect(response.status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 428, 'NOTEBOOK_ACTOR_REQUIRED'],
    ['other-learner', 401, 'NOTEBOOK_ACTOR_CHANGED'],
  ])('rejects notebook submission actor precondition %s before the service', async (expectedActor,status,code) => {
    const payload={notebook:{assetId:'artifact-1',checksum:'b'.repeat(64),format:'ipynb',templateChecksum:'a'.repeat(64)}};
    const response=await submitAssignment(jsonRequest('http://localhost/api/v1/assignments/submit',{
      courseId:'course-1',itemId:'assignment',payload,
    },'POST',expectedActor?{'X-Notebook-Actor':expectedActor}:{}));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({error:{code}});
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('accepts a notebook submission only when its actor precondition matches the authenticated learner', async () => {
    mocks.getActor.mockResolvedValue({...learnerActor,authorization:{source:'database',accountStatus:'active',memberships:[],assignments:[]}});
    const payload={notebook:{assetId:'artifact-1',checksum:'b'.repeat(64),format:'ipynb',templateChecksum:'a'.repeat(64)}};
    const response=await submitAssignment(jsonRequest('http://localhost/api/v1/assignments/submit',{
      courseId:'course-1',itemId:'assignment',payload,
    },'POST',{'X-Notebook-Actor':'learner-1'}));
    expect(response.status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      ...learnerActor,authorization:{source:'database',accountStatus:'active',memberships:[],assignments:[]},
    }),{courseId:'course-1',itemId:'assignment',blockId:null},null,payload);
  });

  it('rejects a suspended notebook submitter before calling the submission service',async()=>{
    mocks.getActor.mockResolvedValue({...learnerActor,authorization:{source:'database',accountStatus:'suspended',memberships:[],assignments:[]}});
    const payload={notebook:{assetId:'artifact-1',checksum:'b'.repeat(64),format:'ipynb',templateChecksum:'a'.repeat(64)}};
    const response=await submitAssignment(jsonRequest('http://localhost/api/v1/assignments/submit',{
      courseId:'course-1',itemId:'assignment',payload,
    },'POST',{'X-Notebook-Actor':'learner-1'}));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({error:{code:'ACCOUNT_INACTIVE'}});
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('lists only the authenticated learner submissions for the route item and course query', async () => {
    const response = await mine(
      new Request('http://localhost/api/v1/assignments/assignment/submissions?courseId=course-1'),
      { params: Promise.resolve({ itemId: 'assignment' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.session).toHaveBeenCalledWith(
      learnerActor,
      { courseId: 'course-1', itemId: 'assignment', blockId: null },
    );
  });

  it('passes an explicit inline block locator to learner history', async () => {
    const response = await mine(
      new Request('http://localhost/api/v1/assignments/lesson-1/submissions?courseId=course-1&blockId=inline-task'),
      { params: Promise.resolve({ itemId: 'lesson-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.session).toHaveBeenCalledWith(
      learnerActor,
      { courseId: 'course-1', itemId: 'lesson-1', blockId: 'inline-task' },
    );
  });

  it('requires submission.grade at the requested branch before listing the Studio queue', async () => {
    const response = await queueSubmissions(new Request(
      'http://localhost/api/v1/studio/submissions?branchId=vinsmc&courseId=course-1&status=submitted',
    ));

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith('submission.grade', { branchId: 'vinsmc' });
    expect(mocks.queue).toHaveBeenCalledWith(instructor, {
      branchId: 'vinsmc', courseId: 'course-1', assignmentId: undefined,
      status: 'submitted', cursor: undefined,
    });
  });

  it('accepts the "Waiting" (pending) queue filter and rejects unknown statuses', async () => {
    const response = await queueSubmissions(new Request(
      'http://localhost/api/v1/studio/submissions?branchId=vinsmc&status=pending',
    ));

    expect(response.status).toBe(200);
    expect(mocks.queue).toHaveBeenCalledWith(instructor, {
      branchId: 'vinsmc', courseId: undefined, assignmentId: undefined,
      status: 'pending', cursor: undefined,
    });

    mocks.queue.mockClear();
    const rejected = await queueSubmissions(new Request(
      'http://localhost/api/v1/studio/submissions?branchId=vinsmc&status=waiting',
    ));
    expect(rejected.status).toBe(400);
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it('accepts an unscoped queue for an actor who grades multiple branches', async () => {
    const multiBranchInstructor = {
      userId: 'instructor-multi',
      roles: [
        { role: 'instructor' as const, branchId: 'vinsmc' },
        { role: 'instructor' as const, branchId: 'ans' },
      ],
    };
    mocks.getActor.mockResolvedValue(multiBranchInstructor);

    const response = await queueSubmissions(new Request('http://localhost/api/v1/studio/submissions'));

    expect(response.status).toBe(200);
    expect(mocks.queue).toHaveBeenCalledWith(multiBranchInstructor, {
      branchId: undefined, courseId: undefined, assignmentId: undefined,
      status: undefined, cursor: undefined,
    });
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });

  it('passes assignment and cursor filters through the authorized queue route', async () => {
    const response = await queueSubmissions(new Request(
      'http://localhost/api/v1/studio/submissions?branchId=vinsmc&assignmentId=inline-task&cursor=cursor-token',
    ));

    expect(response.status).toBe(200);
    expect(mocks.queue).toHaveBeenCalledWith(instructor, {
      branchId: 'vinsmc', courseId: undefined, assignmentId: 'inline-task',
      status: undefined, cursor: 'cursor-token',
    });
  });

  it('validates grade bodies and passes the full permission-derived Actor', async () => {
    const body = {
      rubricScores: { quality: 4 }, feedback: { en: 'Good' }, decision: 'approved', release: true,
    };
    const response = await gradeSubmission(
      jsonRequest('http://localhost/api/v1/studio/submissions/submission-1/grade?branchId=vinsmc', body),
      { params: Promise.resolve({ id: 'submission-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.requirePermission).toHaveBeenCalledWith('submission.grade', { branchId: 'vinsmc' });
    expect(mocks.grade).toHaveBeenCalledWith(instructor, 'submission-1', body);
  });

  it('returns permission errors before parsing a denied grade request', async () => {
    mocks.requirePermission.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Permission denied'));
    const request = new Request('http://localhost/api/v1/studio/submissions/submission-1/grade?branchId=ans', { method: 'POST' });
    vi.spyOn(request, 'json');

    const response = await gradeSubmission(request, { params: Promise.resolve({ id: 'submission-1' }) });

    expect(response.status).toBe(403);
    expect(request.json).not.toHaveBeenCalled();
    expect(mocks.grade).not.toHaveBeenCalled();
  });
});

describe('learner upload route', () => {
  const uploadFile = vi.fn();
  const remove = vi.fn();
  const insert = vi.fn();
  const claimUpload = vi.fn();
  const updateProfile = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue(learner);
    mocks.authorizeUpload.mockResolvedValue({ courseVersionId: 'version-1', itemId: 'assignment' });
    mocks.imageSize.mockReturnValue({ width: 640, height: 480 });
    uploadFile.mockResolvedValue({ error: null });
    remove.mockResolvedValue({ error: null });
    insert.mockResolvedValue({ error: null });
    claimUpload.mockResolvedValue({ data: true, error: null });
    updateProfile.mockResolvedValue({ error: null });
    mocks.supabaseService.mockReturnValue({
      storage: { from: vi.fn(() => ({ upload: uploadFile, remove })) },
      from: vi.fn((table: string) => table === 'profiles'
        ? { update: vi.fn(() => ({ eq: vi.fn(() => updateProfile()) })) }
        : { insert }),
      rpc: claimUpload,
    });
  });

  it('stores a profile image through the shared upload endpoint without assignment context', async () => {
    const response = await upload(uploadRequest(
      new File([new Uint8Array([137, 80, 78, 71])], 'avatar.png', { type: 'image/png' }),
      { courseId: null, itemId: null, purpose: 'avatar' },
    ));

    expect(response.status).toBe(200);
    expect(mocks.authorizeUpload).not.toHaveBeenCalled();
    expect(mocks.supabaseService.mock.results[0].value.storage.from).toHaveBeenCalledWith('media');
    expect(updateProfile).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ data: expect.objectContaining({
      assetId: expect.stringMatching(/^asset_/), url: expect.stringMatching(/^\/api\/v1\/media\/asset_/),
    }) });
  });

  it('stores a project cover in the media bucket without touching the learner profile', async () => {
    const response = await upload(uploadRequest(
      new File([new Uint8Array([137, 80, 78, 71])], 'cover.png', { type: 'image/png' }),
      { courseId: null, itemId: null, purpose: 'project_cover' },
    ));

    expect(response.status).toBe(200);
    expect(mocks.authorizeUpload).not.toHaveBeenCalled();
    expect(mocks.supabaseService.mock.results[0].value.storage.from).toHaveBeenCalledWith('media');
    expect(mocks.supabaseService.mock.results[0].value.from).not.toHaveBeenCalledWith('profiles');
    expect(updateProfile).not.toHaveBeenCalled();
    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/^learner-1\/project-cover\/asset_[A-Z0-9]+\/cover\.png$/),
      expect.any(File),
      { contentType: 'image/png', upsert: false },
    );
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: 'learner-1', bucket: 'media', purpose: 'project_cover', mime: 'image/png',
    }));
    expect(claimUpload).toHaveBeenCalledWith('rate_limit', expect.objectContaining({
      key: 'learner:upload:user:learner-1',
    }));
    await expect(response.json()).resolves.toEqual({ data: {
      assetId: expect.stringMatching(/^asset_/),
      url: expect.stringMatching(/^\/api\/v1\/media\/asset_/),
      name: 'cover.png',
      size: 4,
      mime: 'image/png',
    } });
  });

  it('rejects a project cover that is not a JPEG, PNG, or WebP image', async () => {
    const response = await upload(uploadRequest(
      new File([new Uint8Array([71, 73, 70, 56])], 'cover.gif', { type: 'image/gif' }),
      { courseId: null, itemId: null, purpose: 'project_cover' },
    ));

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'UNSUPPORTED_PROJECT_COVER' } });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('stores a learner file in the private submissions bucket under the learner prefix', async () => {
    const response = await upload(uploadRequest(new File(['pdf'], '../work.pdf', { type: 'application/pdf' })));

    expect(response.status).toBe(200);
    const storageFrom = mocks.supabaseService.mock.results[0].value.storage.from;
    expect(storageFrom).toHaveBeenCalledWith('submissions');
    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/^learner-1\/asset_[A-Z0-9]+\/work\.pdf$/),
      expect.any(File),
      { contentType: 'application/pdf', upsert: false },
    );
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: 'learner-1', bucket: 'submissions', item_id: 'assignment', mime: 'application/pdf', size_bytes: 3,
    }));
    expect(mocks.authorizeUpload).toHaveBeenCalledWith(
      learnerActor,
      { courseId: 'course-1', itemId: 'assignment', blockId: null },
      { size: 3, mime: 'application/pdf' },
    );
    await expect(response.json()).resolves.toEqual({ data: {
      assetId: expect.stringMatching(/^asset_/), name: 'work.pdf', size: 3, mime: 'application/pdf',
    } });
  });

  it('accepts the assignment-spec ZIP MIME when its extension matches', async () => {
    const response = await upload(uploadRequest(new File(['zip'], 'project.zip', { type: 'application/zip' })));

    expect(response.status).toBe(200);
    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/project\.zip$/),
      expect.any(File),
      { contentType: 'application/zip', upsert: false },
    );
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ mime: 'application/zip' }));
  });

  it('rejects MIME-extension mismatches before writing storage', async () => {
    const response = await upload(uploadRequest(new File(['payload'], 'work.exe', { type: 'application/pdf' })));

    expect(response.status).toBe(415);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('requires courseId and itemId before authorizing or storing a learner upload', async () => {
    const response = await upload(uploadRequest(
      new File(['pdf'], 'work.pdf', { type: 'application/pdf' }),
      { itemId: null },
    ));

    expect(response.status).toBe(400);
    expect(mocks.authorizeUpload).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('enforces the enrolled assignment file spec before storage is touched', async () => {
    mocks.authorizeUpload.mockRejectedValue(new ApiError(413, 'FILE_TOO_LARGE', 'Submission file exceeds the assignment size limit'));

    const response = await upload(uploadRequest(new File(['pdf'], 'work.pdf', { type: 'application/pdf' })));

    expect(response.status).toBe(413);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects oversized Content-Length before parsing multipart data', async () => {
    const formData = vi.fn();
    const request = {
      headers: new Headers({ 'Content-Length': String(MAX_MEDIA_BYTES + 1) }),
      formData,
    } as unknown as Request;

    const response = await upload(request);

    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rejects Content-Length zero as an empty upload with a clear 400 response', async () => {
    const formData = vi.fn();
    const request = {
      headers: new Headers({ 'Content-Length': '0' }),
      formData,
    } as unknown as Request;

    const response = await upload(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'EMPTY_UPLOAD', message: 'Upload body must not be empty' },
    });
    expect(formData).not.toHaveBeenCalled();
  });

  it('accepts a chunked multipart upload through the bounded body reader', async () => {
    const response = await upload(chunkedUploadRequest(
      new File(['pdf'], 'work.pdf', { type: 'application/pdf' }),
    ));

    expect(response.status).toBe(200);
    expect(uploadFile).toHaveBeenCalledOnce();
  });

  it('authenticates before parsing multipart data', async () => {
    mocks.requireApiUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
    const formData = vi.fn();
    const request = {
      headers: new Headers({ 'Content-Length': '1024' }),
      formData,
    } as unknown as Request;

    const response = await upload(request);

    expect(response.status).toBe(401);
    expect(formData).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rate limits repeated uploads per authenticated learner before parsing the next body', async () => {
    mocks.requireApiUser.mockResolvedValue({ id: 'rate-limited-learner' });
    claimUpload.mockImplementation(async () => ({
      data: claimUpload.mock.calls.length <= 10,
      error: null,
    }));
    const responses: Response[] = [];
    for (let index = 0; index < 11; index += 1) {
      responses.push(await upload(uploadRequest(new File(['pdf'], `work-${index}.pdf`, { type: 'application/pdf' }))));
    }

    expect(responses.slice(0, 10).every(({ status }) => status === 200)).toBe(true);
    expect(responses[10].status).toBe(429);
    await expect(responses[10].json()).resolves.toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many uploads; try again later' },
    });
    expect(uploadFile).toHaveBeenCalledTimes(10);
    expect(claimUpload).toHaveBeenCalledWith('rate_limit', {
      key: 'learner:upload:user:rate-limited-learner', limit: 10, window_seconds: 60,
    });
  });
});
