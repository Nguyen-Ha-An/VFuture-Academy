import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseService: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import { learnerContext } from '@/features/ecosystem/context';
import { isEligibleResourceAsset } from '@/features/media/access';
import type { Actor } from '@/lib/permissions';
import { successful, SupabaseStub } from '../learner/test-kit';

const school = 'school-a';
const learner = 'learner-1';
const branchScope = { scope: 'branches', branchIds: [school] };

function publishedResource(id: string, scope: { scope: string; branchIds?: string[] }) {
  return {
    id, status: 'published', branch_scope: scope,
    document: {
      schemaVersion: 1, kind: 'resource', id, title: 'Guide', summary: 'Guide summary', resourceType: 'guide',
      branchScope: scope, body: { blocks: [{ type: 'paragraph', content: [{ text: 'Guide' }] }] },
      attachments: [{ src: { assetId: 'asset_guide' }, label: 'Read the guide' }],
    },
  };
}

describe('signed-in school audiences', () => {
  it.each([
    ['suspended', { status: 'suspended' }, null, false],
    ['active', { status: 'active' }, school, true],
    ['legacy', null, school, true],
  ] as const)('resolves %s membership for resource and opportunity discovery and resource attachments', async (_label, membership, expectedBranch, canRead) => {
    const database = new SupabaseStub({
      profiles: [successful({ branch_id: school }), successful({ branch_id: school })],
      branch_memberships: [successful(membership), successful(membership)],
      resources: [successful([publishedResource('school-guide', branchScope)])],
    });
    mocks.supabaseService.mockReturnValue(database);

    await expect(learnerContext(learner, 'en')).resolves.toEqual({ userId: learner, branchId: expectedBranch, locale: 'en' });
    await expect(isEligibleResourceAsset(mocks.supabaseService(), learner, 'asset_guide')).resolves.toBe(canRead);
    for (const lookup of database.queriesFor('branch_memberships')) {
      expect(lookup.operations).toContainEqual(['eq', 'user_id', learner]);
      expect(lookup.operations).toContainEqual(['eq', 'branch_id', school]);
    }
  });

  it('keeps the independent global resource attachment grant for a learner suspended at their primary school', async () => {
    const actor: Actor = { userId: learner, roles: [], authorization: {
      source: 'database', accountStatus: 'active', assignments: [],
      memberships: [{ branchId: school, status: 'suspended' }, { branchId: 'school-b', status: 'active' }],
    } };
    const database = new SupabaseStub({
      profiles: [successful({ branch_id: school })],
      resources: [successful([publishedResource('school-guide', branchScope), publishedResource('global-guide', { scope: 'global' })])],
    });
    mocks.supabaseService.mockReturnValue(database);

    await expect(isEligibleResourceAsset(mocks.supabaseService(), actor, 'asset_guide')).resolves.toBe(true);
    expect(database.queriesFor('branch_memberships')).toHaveLength(0);
  });

  it('fails closed on membership lookup failure', async () => {
    const database = new SupabaseStub({
      profiles: [successful({ branch_id: school })],
      branch_memberships: [{ data: null, error: new Error('lookup unavailable') }],
    });
    mocks.supabaseService.mockReturnValue(database);
    await expect(learnerContext(learner, 'vi')).rejects.toMatchObject({ status: 503, code: 'MEMBERSHIP_ACCESS_UNAVAILABLE' });
  });
});
