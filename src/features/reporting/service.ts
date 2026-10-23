import 'server-only';

import { z } from 'zod';

import { ApiError } from '@/lib/api';
import { can, type Actor, type Scope } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import {
  STUDIO_REPORT_TIMEZONE,
  type ReportPublication,
  type StudioLearningReport,
  type StudioReportQuery,
} from './contracts';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');

const QuerySchema = z.object({
  from: DateSchema.optional(),
  to: DateSchema.optional(),
  branchId: z.string().min(1).max(100).optional(),
  courseId: z.string().min(1).max(64).optional(),
  publication: z.enum(['released', 'unreleased', 'all']).optional(),
}).strict().superRefine(({ from, to }, context) => {
  if ((from === undefined) !== (to === undefined)) {
    context.addIssue({ code: 'custom', path: [from ? 'to' : 'from'], message: 'from and to must be provided together' });
    return;
  }
  if (!from || !to) return;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (start > end) context.addIssue({ code: 'custom', path: ['to'], message: 'to must not be before from' });
  if ((end - start) / 86_400_000 + 1 > 366) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'Report range cannot exceed 366 days' });
  }
});

export function studioReportQueryFromUrl(url: string): StudioReportQuery {
  const params = new URL(url).searchParams;
  return QuerySchema.parse({
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    branchId: params.get('branchId') ?? undefined,
    courseId: params.get('courseId') ?? undefined,
    publication: params.get('publication') ?? undefined,
  });
}

export type ReportRepositoryInput = {
  actorId: string;
  branchId: string | null;
  courseId: string | null;
  from: string;
  to: string;
  publication: ReportPublication;
  includeUnknownHistoricalBranch: boolean;
};

export type StudioReportDependencies = {
  report(input: ReportRepositoryInput): Promise<Omit<StudioLearningReport, 'period' | 'filters' | 'visibility'>>;
  now?: () => Date;
};

function localCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STUDIO_REPORT_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function subtractDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function assertReportShape(value: unknown): asserts value is Omit<StudioLearningReport, 'period' | 'filters' | 'visibility'> {
  if (typeof value !== 'object' || value === null
    || !('overview' in value) || !('courses' in value)
    || !('questions' in value) || !('grading' in value)) {
    throw new ApiError(500, 'REPORT_DATABASE_ERROR', 'Learning report returned an invalid result');
  }
}

export function createStudioReportingService(dependencies: StudioReportDependencies) {
  return {
    async load(actor: Actor, scope: Scope, rawQuery: StudioReportQuery): Promise<StudioLearningReport> {
      const query = QuerySchema.parse(rawQuery);
      let branchId = query.branchId ?? null;
      let includeUnknownHistoricalBranch = false;
      if (scope.kind === 'branch') {
        if (branchId !== null && branchId !== scope.branchId) {
          throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
        }
        branchId = scope.branchId;
        if (!can(actor, 'report.branch.read', scope) && !can(actor, 'analytics.branch.read', scope)) {
          throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
        }
      } else {
        if (!can(actor, 'report.global.read', scope) && !can(actor, 'analytics.global.read', scope)) {
          throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
        }
        includeUnknownHistoricalBranch = branchId === null;
      }

      const to = query.to ?? localCalendarDate(dependencies.now?.() ?? new Date());
      const from = query.from ?? subtractDays(to, 29);
      const publication = query.publication ?? 'released';
      const result = await dependencies.report({
        actorId: actor.userId,
        branchId,
        courseId: query.courseId ?? null,
        from,
        to,
        publication,
        includeUnknownHistoricalBranch,
      });
      assertReportShape(result);
      return {
        period: { from, to, timezone: STUDIO_REPORT_TIMEZONE },
        filters: { branchId, courseId: query.courseId ?? null, publication },
        visibility: { unknownHistoricalBranch: includeUnknownHistoricalBranch },
        ...result,
      };
    },
  };
}

type ReportRpcDatabase = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown | null }>;
};

export function createSupabaseStudioReportRepository(
  database = supabaseService() as unknown as ReportRpcDatabase,
) {
  return async (input: ReportRepositoryInput) => {
    const { data, error } = await database.rpc('studio_learning_report', {
      p_actor_user_id: input.actorId,
      p_branch_id: input.branchId,
      p_course_id: input.courseId,
      p_from: input.from,
      p_to: input.to,
      p_publication: input.publication,
      p_include_unknown_historical_branch: input.includeUnknownHistoricalBranch,
    });
    if (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : '';
      if (code === '42501') throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      throw new ApiError(500, 'REPORT_DATABASE_ERROR', 'Unable to load learning report');
    }
    assertReportShape(data);
    return data;
  };
}

export async function loadStudioLearningReport(
  actor: Actor,
  scope: Scope,
  query: StudioReportQuery,
  dependencies: StudioReportDependencies = { report: createSupabaseStudioReportRepository() },
) {
  return createStudioReportingService(dependencies).load(actor, scope, query);
}
