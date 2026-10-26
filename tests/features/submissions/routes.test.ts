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

describe('retired learner multipart upload route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireApiUser.mockResolvedValue(learner); });
  it.each(['avatar', 'project_cover', 'submission'])('requires direct reservation for %s without parsing or storage access', async (purpose) => {
    const request = uploadRequest(new File(['payload'], 'work.txt', { type: 'text/plain' }), { purpose });
    const parse = vi.spyOn(request, 'formData');
    const response = await upload(request);
    expect(response.status).toBe(410);
    expect((await response.json()).error.code).toBe('DIRECT_UPLOAD_REQUIRED');
    expect(parse).not.toHaveBeenCalled();
    expect(mocks.supabaseService).not.toHaveBeenCalled();
  });
  it('rejects declared bodies above four MiB before parsing', async () => {
    const request = new Request('http://localhost/api/v1/uploads', { method: 'POST', headers: { 'content-length': String(4 * 1024 * 1024 + 1) } });
    expect((await upload(request)).status).toBe(413);
  });
  it('does not permit a chunked multipart bypass', async () => {
    expect((await upload(chunkedUploadRequest(new File(['work'], 'work.txt', { type: 'text/plain' })))).status).toBe(410);
    expect(mocks.supabaseService).not.toHaveBeenCalled();
  });
  it('authenticates before retiring the request', async () => {
    mocks.requireApiUser.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
    expect((await upload(uploadRequest(new File(['work'], 'work.txt')))).status).toBe(401);
  });
});
