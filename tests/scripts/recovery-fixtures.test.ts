import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { CourseDocumentSchema } from '../../src/content-engine/schema/course';
import { ResourceDocumentSchema } from '../../src/content-engine/schema/bundle';
import { OpportunityFormSchema } from '../../src/features/opportunities/schema';
import { ProjectInputSchema } from '../../src/features/projects/service';
import {
  recoveryFixtureData,
  recoveryOpportunitySchedulePatch,
  runRecoveryFixtureSeed,
  type RecoveryFixtureServices,
} from '../../scripts/lib/recovery-fixtures';

const NOW = new Date('2026-09-05T04:00:00.000Z');
const OWNER_ID = '11111111-1111-4111-8111-111111111111';

describe('recovery staging fixtures', () => {
  it('provides bilingual, namespaced documents accepted by production schemas', () => {
    const fixtures = recoveryFixtureData(NOW, OWNER_ID);
    const documents = [
      ...fixtures.courses.map(({ document }) => document),
      ...fixtures.resources,
      ...fixtures.opportunities,
      ...fixtures.projects,
    ];

    expect(documents.every(({ id }) => id.startsWith('recovery-'))).toBe(true);
    expect(fixtures.courses.every(({ document }) => CourseDocumentSchema.safeParse(document).success)).toBe(true);
    expect(fixtures.resources.every((document) => ResourceDocumentSchema.safeParse(document).success)).toBe(true);
    expect(fixtures.opportunities.every((document) => OpportunityFormSchema.safeParse(document).success)).toBe(true);
    expect(fixtures.projects.every((document) => ProjectInputSchema.safeParse(document).success)).toBe(true);
    for (const document of documents) {
      expect(document.title).toEqual(expect.objectContaining({ vi: expect.any(String), en: expect.any(String) }));
    }

    expect(fixtures.courses.map(({ document }) => document.access)).toEqual(expect.arrayContaining([
      { scope: 'global' },
      { scope: 'branches', branchIds: ['vinsmc'] },
    ]));
    expect(fixtures.resources.map(({ branchScope }) => branchScope)).toEqual(expect.arrayContaining([
      { scope: 'global' },
      { scope: 'branches', branchIds: ['vinsmc'] },
    ]));
    expect(fixtures.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ approved: true }),
      expect.objectContaining({ approved: false }),
      expect.objectContaining({ branchScope: { scope: 'branches', branchIds: ['vinsmc'] } }),
    ]));
  });

  it('derives stable open, upcoming, and expired windows from the injected clock', () => {
    const first = recoveryFixtureData(NOW, OWNER_ID);
    const second = recoveryFixtureData(new Date(NOW), OWNER_ID);

    expect(second).toEqual(first);
    const [open, upcoming, expired] = first.opportunities;
    expect(new Date(open.openAt!).getTime()).toBeLessThan(NOW.getTime());
    expect(new Date(open.closeAt!).getTime()).toBeGreaterThan(NOW.getTime());
    expect(new Date(upcoming.openAt!).getTime()).toBeGreaterThan(NOW.getTime());
    expect(new Date(expired.closeAt!).getTime()).toBeLessThan(NOW.getTime());
  });

  it('creates and publishes missing fixtures, repairs drafts, and is a no-op after success', async () => {
    const fixtures = recoveryFixtureData(NOW, OWNER_ID);
    const states = new Map<string, 'draft' | 'published'>();
    states.set(fixtures.resources[1].id, 'draft');
    const services: RecoveryFixtureServices = {
      contentState: vi.fn(async (_kind, id) => states.get(id) ?? 'missing'),
      createCourse: vi.fn(async ({ document }) => { states.set(document.id, 'draft'); }),
      importCourse: vi.fn(async () => undefined),
      publishCourse: vi.fn(async (id) => { states.set(id, 'published'); }),
      saveResource: vi.fn(async (document) => { states.set(document.id, 'draft'); }),
      publishResource: vi.fn(async (id) => { states.set(id, 'published'); }),
      saveOpportunity: vi.fn(async (document) => { states.set(document.id, 'draft'); }),
      publishOpportunity: vi.fn(async (id) => { states.set(id, 'published'); }),
      refreshOpportunitySchedule: vi.fn(async () => false),
      createProject: vi.fn(async (document) => { states.set(document.id, 'published'); }),
    };

    const first = await runRecoveryFixtureSeed(fixtures, services);
    const second = await runRecoveryFixtureSeed(fixtures, services);

    expect(services.saveResource).toHaveBeenCalledWith(fixtures.resources[1]);
    expect(services.publishResource).toHaveBeenCalledWith(fixtures.resources[1].id);
    expect(services.createCourse).toHaveBeenCalledTimes(fixtures.courses.length);
    expect(services.saveResource).toHaveBeenCalledTimes(fixtures.resources.length);
    expect(services.saveOpportunity).toHaveBeenCalledTimes(fixtures.opportunities.length);
    expect(services.createProject).toHaveBeenCalledTimes(fixtures.projects.length);
    expect(first).toEqual({
      coursesCreated: fixtures.courses.length,
      coursesPublished: fixtures.courses.length,
      resourcesCreated: fixtures.resources.length - 1,
      resourcesPublished: fixtures.resources.length,
      opportunitiesCreated: fixtures.opportunities.length,
      opportunitiesPublished: fixtures.opportunities.length,
      opportunitySchedulesRefreshed: 0,
      projectsCreated: fixtures.projects.length,
    });
    expect(second).toEqual({
      coursesCreated: 0,
      coursesPublished: 0,
      resourcesCreated: 0,
      resourcesPublished: 0,
      opportunitiesCreated: 0,
      opportunitiesPublished: 0,
      opportunitySchedulesRefreshed: 0,
      projectsCreated: 0,
    });
  });

  it('refreshes only published fixture schedules when the injected clock advances', async () => {
    const initial = recoveryFixtureData(NOW, OWNER_ID);
    const schedules = new Map(initial.opportunities.map((opportunity) => [opportunity.id, {
      openAt: opportunity.openAt,
      closeAt: opportunity.closeAt,
      startAt: opportunity.startAt,
      endAt: opportunity.endAt,
    }]));
    const saveOpportunity = vi.fn(async () => undefined);
    const publishOpportunity = vi.fn(async () => undefined);
    const services = {
      contentState: vi.fn(async () => 'published' as const),
      saveOpportunity,
      publishOpportunity,
      refreshOpportunitySchedule: vi.fn(async (id, desired) => {
        const changed = JSON.stringify(schedules.get(id)) !== JSON.stringify(desired);
        if (changed) schedules.set(id, desired);
        return changed;
      }),
    } as unknown as RecoveryFixtureServices;
    const advancedNow = new Date(NOW.getTime() + 40 * 24 * 60 * 60 * 1_000);
    const advanced = recoveryFixtureData(advancedNow, OWNER_ID);

    const refreshed = await runRecoveryFixtureSeed(advanced, services);
    const unchanged = await runRecoveryFixtureSeed(advanced, services);

    expect(refreshed.opportunitySchedulesRefreshed).toBe(advanced.opportunities.length);
    expect(unchanged.opportunitySchedulesRefreshed).toBe(0);
    expect(saveOpportunity).not.toHaveBeenCalled();
    expect(publishOpportunity).not.toHaveBeenCalled();
    const [open, upcoming, expired] = advanced.opportunities.map(({ id }) => schedules.get(id)!);
    expect(new Date(open.openAt!).getTime()).toBeLessThan(advancedNow.getTime());
    expect(new Date(open.closeAt!).getTime()).toBeGreaterThan(advancedNow.getTime());
    expect(new Date(upcoming.openAt!).getTime()).toBeGreaterThan(advancedNow.getTime());
    expect(new Date(expired.closeAt!).getTime()).toBeLessThan(advancedNow.getTime());
  });

  it('builds schedule-only patches for marked fixtures and rejects accidental recovery ids', () => {
    const desiredOpportunity = recoveryFixtureData(NOW, OWNER_ID).opportunities[0];
    const desired = {
      openAt: desiredOpportunity.openAt,
      closeAt: desiredOpportunity.closeAt,
      startAt: desiredOpportunity.startAt,
      endAt: desiredOpportunity.endAt,
    };
    const accidentalRow = {
      id: desiredOpportunity.id,
      status: 'published',
      organization: 'Student-authored organization',
      title: { vi: 'Nội dung biên tập', en: 'Editorial content' },
      open_at: '2020-01-01T00:00:00.000Z',
      close_at: '2020-01-02T00:00:00.000Z',
      start_at: null,
      end_at: null,
    };
    const managedRow = {
      ...accidentalRow,
      organization: 'VFuture Labs — Recovery Sample',
      title: desiredOpportunity.title,
    };

    expect(recoveryOpportunitySchedulePatch(accidentalRow, desired)).toBeNull();
    expect(recoveryOpportunitySchedulePatch(managedRow, desired)).toEqual({
      open_at: desired.openAt,
      close_at: desired.closeAt,
      start_at: desired.startAt,
      end_at: desired.endAt,
    });
    expect(recoveryOpportunitySchedulePatch({
      ...managedRow,
      open_at: desired.openAt,
      close_at: desired.closeAt,
      start_at: desired.startAt,
      end_at: desired.endAt,
    }, desired)).toBeNull();
  });

  it('refuses to write any fixture whose top-level id leaves the recovery namespace', async () => {
    const fixtures = recoveryFixtureData(NOW, OWNER_ID);
    fixtures.resources[0] = { ...fixtures.resources[0], id: 'existing-editorial-resource' };
    const services = {
      contentState: vi.fn(async () => 'missing' as const),
    } as unknown as RecoveryFixtureServices;

    await expect(runRecoveryFixtureSeed(fixtures, services)).rejects.toThrow('recovery-* namespace');
    expect(services.contentState).not.toHaveBeenCalled();
  });
});
