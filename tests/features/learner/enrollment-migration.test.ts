import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ supabaseService: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: mocks.supabaseService }));

import { createEnrollmentMigrationService, migrateEnrollments } from '@/features/enrollment/migrate';
import { successful, SupabaseStub } from './test-kit';

const enrollment = (index: number) => ({
  id: `enrollment-${String(index).padStart(3, '0')}`,
  user_id: `user-${String(index).padStart(3, '0')}`,
  course_version_id: 'version-old',
  status: 'active',
});

afterEach(() => vi.clearAllMocks());

describe('enrollment migration service', () => {
  it('continues after one learner RPC fails and reports that learner as skipped', async () => {
    const database = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', current_version_id: 'version-new' })],
      enrollments: [successful([enrollment(1), enrollment(2), enrollment(3)])],
    }, {
      learner_migrate_enrollment: [
        successful([{ status: 'migrated', reason: null }]),
        { data: null, error: { message: 'constraint failure' } },
        successful([{ status: 'migrated', reason: null }]),
      ],
    });

    const result = await createEnrollmentMigrationService({ database }).migrate('ai-foundations');

    expect(result).toEqual({
      migrated: ['user-001', 'user-003'],
      skipped: [{ userId: 'user-002', reason: 'MIGRATION_FAILED' }],
    });
    expect(database.rpcCalls).toEqual([
      {
        name: 'learner_migrate_enrollment',
        args: {
          p_user_id: 'user-001',
          p_course_id: 'ai-foundations',
          p_from_version: 'version-old',
          p_to_version: 'version-new',
        },
      },
      {
        name: 'learner_migrate_enrollment',
        args: {
          p_user_id: 'user-002',
          p_course_id: 'ai-foundations',
          p_from_version: 'version-old',
          p_to_version: 'version-new',
        },
      },
      {
        name: 'learner_migrate_enrollment',
        args: {
          p_user_id: 'user-003',
          p_course_id: 'ai-foundations',
          p_from_version: 'version-old',
          p_to_version: 'version-new',
        },
      },
    ]);
    expect(database.queriesFor('lesson_progress')).toHaveLength(0);
  });

  it('paginates active outdated enrollments in batches of 100', async () => {
    const firstBatch = Array.from({ length: 100 }, (_, index) => enrollment(index + 1));
    const database = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', current_version_id: 'version-new' })],
      enrollments: [successful(firstBatch), successful([enrollment(101)])],
    }, {
      learner_migrate_enrollment: Array.from({ length: 101 }, () => (
        successful([{ status: 'migrated', reason: null }])
      )),
    });

    const result = await createEnrollmentMigrationService({ database }).migrate('ai-foundations');

    expect(result.migrated).toHaveLength(101);
    expect(database.queriesFor('enrollments')).toHaveLength(2);
    for (const query of database.queriesFor('enrollments')) {
      expect(query.operations).toContainEqual(['limit', 100]);
      expect(query.operations).toContainEqual(['order', 'id', { ascending: true }]);
    }
    expect(database.queriesFor('enrollments')[1].operations).toContainEqual([
      'gt', 'id', 'enrollment-100',
    ]);
  });

  it('returns eligibility skips from the atomic migration function', async () => {
    const database = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', current_version_id: 'version-new' })],
      enrollments: [successful([enrollment(1)])],
    }, {
      learner_migrate_enrollment: [successful([{
        status: 'skipped',
        reason: 'ITEM_NOT_IN_LATEST_VERSION',
      }])],
    });

    await expect(createEnrollmentMigrationService({ database }).migrate('ai-foundations')).resolves.toEqual({
      migrated: [],
      skipped: [{ userId: 'user-001', reason: 'ITEM_NOT_IN_LATEST_VERSION' }],
    });
  });

  it('adds profile handles only to the route-facing skipped-user result', async () => {
    const database = new SupabaseStub({
      courses: [successful({ id: 'ai-foundations', current_version_id: 'version-new' })],
      enrollments: [successful([enrollment(1)])],
      profiles: [successful([{ id: 'user-001', handle: 'avery' }])],
    }, {
      learner_migrate_enrollment: [successful([{
        status: 'skipped',
        reason: 'ITEM_NOT_IN_LATEST_VERSION',
      }])],
    });
    mocks.supabaseService.mockReturnValue(database);

    await expect(migrateEnrollments('ai-foundations')).resolves.toEqual({
      migrated: [],
      skipped: [{
        userId: 'user-001',
        handle: 'avery',
        reason: 'ITEM_NOT_IN_LATEST_VERSION',
      }],
    });
    expect(database.queriesFor('profiles')[0].operations).toContainEqual([
      'in', 'id', ['user-001'],
    ]);
  });
});
