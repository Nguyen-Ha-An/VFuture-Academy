import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  context: { actor: { userId: 'operator' }, scope: { kind: 'branch', branchId: 'ans' } },
  getAdminContext: vi.fn(),
  assertRequestScope: vi.fn(),
  assertSameOrigin: vi.fn(),
  assertAdminPermission: vi.fn(),
  managementRead: vi.fn(),
  managementWrite: vi.fn(),
  actorDisplayNames: vi.fn(),
  versionTitles: vi.fn(),
  getLocale: vi.fn(),
}));

vi.mock('@/features/admin/context', () => ({
  getAdminContext: mocks.getAdminContext,
  assertRequestScope: mocks.assertRequestScope,
  assertSameOrigin: mocks.assertSameOrigin,
  assertAdminPermission: mocks.assertAdminPermission,
}));
vi.mock('@/features/admin/management', () => ({ managementRead: mocks.managementRead, managementWrite: mocks.managementWrite }));
vi.mock('@/features/admin/actor-directory', () => ({ actorDisplayNames: mocks.actorDisplayNames }));
vi.mock('@/features/grading/titles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/grading/titles')>()),
  versionTitles: mocks.versionTitles,
}));
vi.mock('next-intl/server', () => ({ getLocale: mocks.getLocale }));

import { GET } from '@/app/api/v1/admin/users/[userId]/route';

const memberId = '99999999-8888-4777-8666-555555555555';
const grantor = '11111111-2222-4333-8444-555555555555';
const auditor = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const detail = {
  id: 'member-1',
  displayName: 'Mai Nguyen',
  assignments: [{ id: 'a1', grantedBy: grantor }],
  history: [
    { id: 'h1', action: 'user.role', actorId: auditor, targetType: 'user', targetId: 'member-1', at: '2026-09-01T00:00:00.000Z' },
    { id: 'h2', action: 'user.role', actorId: null, targetType: 'user', targetId: 'member-1', at: '2026-09-01T00:00:00.000Z' },
  ],
};

function request() {
  return new Request(`http://localhost/api/v1/admin/users/${memberId}?scope=branch%3Aans`);
}
const route = { params: Promise.resolve({ userId: memberId }) };

describe('admin member detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue(mocks.context);
    mocks.managementRead.mockResolvedValue(detail);
    mocks.versionTitles.mockResolvedValue(new Map());
    mocks.getLocale.mockResolvedValue('en');
  });

  it('adds an actors map for history actors and role grantors', async () => {
    mocks.actorDisplayNames.mockResolvedValue(new Map([
      [auditor, { name: 'Trần Thu Hà', initials: 'TH', avatarUrl: null }],
      [grantor, { name: 'Lê Văn Nam', initials: 'VN', avatarUrl: 'https://example.test/nam.png' }],
    ]));

    const response = await GET(request(), route);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.managementRead).toHaveBeenCalledWith(mocks.context, 'user', { userId: memberId });
    expect([...mocks.actorDisplayNames.mock.calls[0][0]]).toEqual([auditor, null, grantor]);
    expect(body.data.actors).toEqual({
      [auditor]: { name: 'Trần Thu Hà', initials: 'TH', avatarUrl: null },
      [grantor]: { name: 'Lê Văn Nam', initials: 'VN', avatarUrl: 'https://example.test/nam.png' },
    });
    expect(body.data.history).toEqual(detail.history);
  });

  it('omits the map when no names resolve, leaving the detail unchanged', async () => {
    mocks.actorDisplayNames.mockResolvedValue(new Map());
    const body = await (await GET(request(), route)).json();
    expect(body.data).toEqual(detail);
    expect(body.data).not.toHaveProperty('actors');
  });

  it('checks the request scope before reading the member', async () => {
    mocks.assertRequestScope.mockImplementation(() => { throw new Error('active management scope changed'); });
    const response = await GET(request(), route);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(mocks.managementRead).not.toHaveBeenCalled();
    expect(mocks.actorDisplayNames).not.toHaveBeenCalled();
    mocks.assertRequestScope.mockReset();
  });

  it('adds localized course and item titles only for permitted learning and results', async () => {
    const versionId = '12345678-1234-4234-8234-123456789abc';
    mocks.managementRead.mockResolvedValue({
      ...detail,
      actions: { readLearning: true, readSubmissions: true },
      learning: [{ courseId: 'python-basics', courseVersionId: versionId, title: 'python-basics' }],
      submissions: [{ id: 's1', courseVersionId: versionId, itemId: 'essay-one' }],
      examResults: [{ id: 'e1', courseVersionId: versionId, itemId: 'final-exam' }],
    });
    mocks.actorDisplayNames.mockResolvedValue(new Map());
    mocks.versionTitles.mockResolvedValue(new Map([[versionId, {
      courseId: 'python-basics',
      courseTitle: { vi: 'Python cơ bản', en: 'Python Basics' },
      items: new Map([
        ['essay-one', { vi: 'Bài luận đầu tiên', en: 'First essay' }],
        ['final-exam', { vi: 'Bài thi cuối', en: 'Final exam' }],
      ]),
    }]]));

    const body = await (await GET(request(), route)).json();

    expect(mocks.versionTitles).toHaveBeenCalledWith([versionId]);
    expect(body.data.learning[0].displayTitle).toBe('Python Basics');
    expect(body.data.submissions[0].displayTitle).toBe('First essay');
    expect(body.data.examResults[0].displayTitle).toBe('Final exam');
  });

  it('leaves missing historical titles absent and does not look up lists the viewer cannot read', async () => {
    const versionId = '12345678-1234-4234-8234-123456789abc';
    const hiddenId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    mocks.managementRead.mockResolvedValue({
      ...detail,
      actions: { readLearning: true, readSubmissions: false },
      learning: [{ courseId: 'historical-course', courseVersionId: versionId, title: 'historical-course' }],
      submissions: [{ id: 's1', courseVersionId: hiddenId, itemId: 'private-item' }],
    });
    mocks.actorDisplayNames.mockResolvedValue(new Map());

    const body = await (await GET(request(), route)).json();

    expect(mocks.versionTitles).toHaveBeenCalledWith([versionId]);
    expect(body.data.learning[0]).not.toHaveProperty('displayTitle');
    expect(body.data.submissions[0]).not.toHaveProperty('displayTitle');
  });
});
