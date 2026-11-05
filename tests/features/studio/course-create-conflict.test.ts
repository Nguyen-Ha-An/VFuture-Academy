import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({ service: vi.fn(), context: vi.fn(), assignOwnership: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.service }));
vi.mock('@/features/admin/content-review-production', () => ({ typedContentContext: mocks.context }));

import { createCourse } from '@/features/studio/drafts';
import { POST } from '@/app/api/v1/studio/courses/route';

type DatabaseError = { code?: string; message?: string; constraint?: string; table?: string; schema?: string; details?: string | null; hint?: string | null };
type Result = { data: unknown; error: DatabaseError | null };
const actor = { userId: 'synthetic-course-creator', roles: [] };
const input = { id: 'existing-course', title: { vi: 'Khóa học tổng hợp', en: 'Synthetic course' }, languages: ['vi', 'en'], defaultLanguage: 'en', pathway: 'core-future-skills', level: 'foundation' };
const pkMessage = 'duplicate key value violates unique constraint "courses_pkey"';
function database(result: Result) {
  const client = {
    rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<Result>>().mockResolvedValue(result),
    from: vi.fn((_table: string): never => { throw new Error('Create must remain one atomic RPC, without a racing existence query'); }),
  };
  mocks.service.mockReturnValue(client);
  return client;
}
function request(value: unknown = input) {
  return new Request('http://localhost/api/v1/studio/courses', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(value) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.assignOwnership.mockResolvedValue(undefined);
  mocks.context.mockResolvedValue({ context: { actor, scope: { kind: 'central' } }, service: { assignOwnership: mocks.assignOwnership } });
});

describe('specific atomic course identity conflicts', () => {
  it.each(['courses_pkey', 'courses_slug_key'])('maps PostgREST23505 for %s to the existing COURSE_EXISTS409 contract', async constraint => {
    const client = database({ data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${constraint}"`, details: 'NEVER_RETURN_DATABASE_ROW', hint: null } });
    await expect(createCourse(input, actor)).rejects.toMatchObject({ status: 409, code: 'COURSE_EXISTS', message: 'A course with this id already exists' });
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.rpc).toHaveBeenCalledWith('studio_create_course', expect.objectContaining({ p_course_id: input.id, p_actor_id: actor.userId }));
    expect(client.from).not.toHaveBeenCalled();
  });

  it('accepts native pg public.courses constraint metadata without relying on localized database message text', async () => {
    database({ data: null, error: { code: '23505', schema: 'public', table: 'courses', constraint: 'courses_pkey', message: 'Localized native driver message' } });
    await expect(createCourse(input, actor)).rejects.toMatchObject({ status: 409, code: 'COURSE_EXISTS' });
  });

  it.each([
    { code: '23505', message: 'duplicate key value violates unique constraint "course_drafts_pkey"' },
    { code: '23505', message: 'Unidentified unique violation' },
    { code: '23505', schema: 'other_schema', table: 'courses', constraint: 'courses_pkey', message: pkMessage },
    { code: '23505', schema: 'public', table: 'another_table', constraint: 'courses_pkey', message: pkMessage },
    { code: '23505', schema: 'public', table: 'courses', constraint: 'another_constraint', message: pkMessage },
    { code: '23503', message: 'NEVER_RETURN_PRIVATE_FOREIGN_KEY_VALUE' },
    { code: '42501', message: pkMessage },
    { code: 'PGRST000', message: 'NEVER_RETURN_PRIVATE_CONNECTION_URI' },
    { code: 'P0001', message: 'COURSE_EXISTS' },
    { message: pkMessage },
  ])('keeps unrelated/unproven database errors on the existing500 path: %j', async error => {
    database({ data: null, error });
    await expect(createCourse(input, actor)).rejects.toMatchObject({ status: 500, code: 'DATABASE_ERROR', message: 'Unable to create course' });
  });
});

describe('actual POST handler with actual createCourse service', () => {
  it('returns a sanitized409 envelope and does not assign ownership after the failed atomic create', async () => {
    database({ data: null, error: { code: '23505', message: pkMessage, details: 'NEVER_RETURN_DATABASE_ROW' } });
    const response = await POST(request());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({ error: { code: 'COURSE_EXISTS', message: 'A course with this id already exists' } });
    expect(JSON.stringify(body)).not.toContain('NEVER_RETURN_DATABASE_ROW');
    expect(mocks.assignOwnership).not.toHaveBeenCalled();
  });

  it('keeps the route permission403 distinct and never calls the create RPC', async () => {
    const client = database({ data: null, error: null });
    mocks.context.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Permission denied'));
    const response = await POST(request());
    expect(response.status).toBe(403);expect((await response.json()).error.code).toBe('FORBIDDEN');
    expect(client.rpc).not.toHaveBeenCalled();expect(mocks.assignOwnership).not.toHaveBeenCalled();
  });

  it('keeps RPC permission/outage failures500 instead of misreporting a duplicate', async () => {
    database({ data: null, error: { code: '42501', message: 'NEVER_RETURN_INTERNAL_PERMISSION_DETAILS' } });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'DATABASE_ERROR', message: 'Unable to create course' } });
    expect(mocks.assignOwnership).not.toHaveBeenCalled();
  });

  it('accepts a new-id retry with the retained bilingual creation values and assigns only the new identity', async () => {
    const retry = { ...input, id: 'retry-course' };
    const client = database({ data: { course: { id: retry.id }, draft: { id: 'synthetic-draft' } }, error: null });
    const response = await POST(request(retry));
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith('studio_create_course', expect.objectContaining({ p_course_id: retry.id, p_manifest: expect.objectContaining({ id: retry.id, title: input.title, languages: input.languages, defaultLanguage: input.defaultLanguage, pathway: input.pathway, level: input.level }) }));
    expect(mocks.assignOwnership).toHaveBeenCalledTimes(1);
    expect(mocks.assignOwnership).toHaveBeenCalledWith('course', retry.id);
  });
});
