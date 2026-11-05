import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ change: vi.fn(), get: vi.fn(), actor: { userId: 'teacher' } }));
vi.mock('@/features/teaching/service', () => ({ changeAnnouncement: mock.change, getAnnouncement: mock.get }));
vi.mock('@/lib/auth', () => ({ requireApiUser: vi.fn().mockResolvedValue({ id: 'teacher' }) }));
vi.mock('@/lib/permissions', () => ({ requirePermission: vi.fn().mockResolvedValue(mock.actor) }));
import { ApiError } from '@/lib/api';
import { PATCH, DELETE } from '@/app/api/v1/teaching/announcements/[id]/route';
import { POST as publish } from '@/app/api/v1/teaching/announcements/[id]/publish/route';
import { POST as archive } from '@/app/api/v1/teaching/announcements/[id]/archive/route';

const id = '11111111-1111-4111-8111-111111111111';
const context = { params: Promise.resolve({ id }) };
const request = (method: string, body: unknown) => new Request('https://example.test', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('announcement revision mutation contract', () => {
  beforeEach(() => { mock.get.mockReset().mockResolvedValue({ branch_id: 'school' }); mock.change.mockReset().mockResolvedValue({ announcement: { revision: 2 } }); });
  it('requires a positive integer revision for every mutation', async () => {
    for (const [handler, method, body] of [
      [PATCH, 'PATCH', { title: 'Updated' }], [publish, 'POST', {}], [archive, 'POST', { expectedRevision: 0 }], [DELETE, 'DELETE', { expectedRevision: 1.5 }],
    ] as const) {
      expect((await handler(request(method, body), context)).status).toBe(400);
    }
    expect(mock.change).not.toHaveBeenCalled();
  });
  it('forwards the reviewed revision and separates it from edited content', async () => {
    const edit = await PATCH(request('PATCH', { title: 'Updated', expectedRevision: 3 }), context);
    expect(edit.status).toBe(200);
    expect(mock.change).toHaveBeenCalledWith(mock.actor, id, 'school', 'edit', 3, { title: 'Updated' });
    await publish(request('POST', { expectedRevision: 4 }), context);
    expect(mock.change).toHaveBeenLastCalledWith(mock.actor, id, 'school', 'publish', 4);
    await archive(request('POST', { expectedRevision: 5 }), context);
    expect(mock.change).toHaveBeenLastCalledWith(mock.actor, id, 'school', 'archive', 5);
    await DELETE(request('DELETE', { expectedRevision: 6 }), context);
    expect(mock.change).toHaveBeenLastCalledWith(mock.actor, id, 'school', 'delete', 6);
  });
  it('returns a stale conflict without replacing it with a success', async () => {
    mock.change.mockRejectedValueOnce(new ApiError(409, 'STALE_ANNOUNCEMENT', 'Announcement changed'));
    const result = await publish(request('POST', { expectedRevision: 1 }), context);
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ error: { code: 'STALE_ANNOUNCEMENT' } });
  });
  it('rejects unknown fields and an edit with no content', async () => {
    expect((await PATCH(request('PATCH', { expectedRevision: 1 }), context)).status).toBe(400);
    expect((await publish(request('POST', { expectedRevision: 1, title: 'Unexpected' }), context)).status).toBe(400);
    expect(mock.change).not.toHaveBeenCalled();
  });
});
