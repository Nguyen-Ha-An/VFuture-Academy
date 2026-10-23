import 'server-only';
import { isoRevisionTimestamp, sameContentRevision } from '@/features/content-review/revision';

import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import { resolveL10nString, type Locale } from '@/content-engine';
import { IdSchema } from '@/content-engine/schema/common';
import type { RichContent } from '@/content-engine/schema/types';
import { ApiError, toValidationIssues } from '@/lib/api';
import { excludeInternalContent } from '@/lib/internal-content';
import { hasPermission, type Actor, type Permission, type Scope } from '@/lib/permissions';
import {
  OPPORTUNITY_TYPES,
  OpportunityFormSchema,
  safeApplicationUrl,
  type OpportunityForm,
} from './schema';

export { OPPORTUNITY_TYPES, OpportunityFormSchema, type OpportunityForm } from './schema';

type QueryResult = { data: unknown; error: unknown | null; count?: number | null };

export interface OpportunityQuery extends PromiseLike<QueryResult> {
  select(columns: string, options?: { count?: 'exact'; head?: boolean }): this;
  eq(column: string, value: unknown): this;
  in(column: string, value: unknown[]): this;
  or(value: string): this;
  not(column: string, operator: string, value: string): this;
  lte(column: string, value: unknown): this;
  order(column: string, options?: unknown): this;
  limit(value: number): this;
  range(from: number, to: number): this;
  insert(value: unknown): this;
  upsert(value: unknown, options?: unknown): this;
  update(value: unknown): this;
  delete(): this;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

export interface OpportunityDatabase {
  from(table: string): OpportunityQuery;
  rpc(name: string, args?: Record<string, unknown>): Promise<QueryResult>;
}

type OpportunityPermission = Extract<Permission, 'opportunity.edit' | 'opportunity.publish'>;
type PermissionCheck = (permission: OpportunityPermission) => Promise<Actor>;

export type OpportunityContext = {
  userId: string;
  branchId: string | null;
  locale: Locale;
  now?: Date;
};

export const OpportunityListFilterSchema = z.object({
  type: z.enum(OPPORTUNITY_TYPES).optional(),
  openNow: z.boolean().optional(),
  featured: z.boolean().optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
}).strict();

export type OpportunityListFilter = z.infer<typeof OpportunityListFilterSchema>;
export type OpportunityPage = { items: LocalizedOpportunity[]; total: number; page: number; pageSize: 50 };

export type LocalizedOpportunity = {
  id: string;
  title: string;
  organization: string;
  type: OpportunityForm['type'];
  description: RichContent;
  eligibility: Record<string, unknown>;
  recommendedSkills: string[];
  recommendedCourses: string[];
  requiredCourses: string[];
  applicationUrl: string | null;
  internalApplication: boolean;
  openAt: string | null;
  closeAt: string | null;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  online: boolean;
  featured: boolean;
  interested?: boolean;
};

type Dependencies = {
  database: OpportunityDatabase;
  requirePermission: PermissionCheck;
  scope?: Scope;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function databaseError(message: string): never {
  throw new ApiError(500, 'OPPORTUNITY_DATABASE_ERROR', message);
}

function notFound(id: string): never {
  throw new ApiError(404, 'OPPORTUNITY_NOT_FOUND', `Opportunity "${id}" was not found`);
}

function draftConflict(id: string): never {
  throw new ApiError(409, 'OPPORTUNITY_DRAFT_CONFLICT', `Opportunity "${id}" changed before it could be published`);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function localizedRichContent(value: unknown, locale: Locale): RichContent | null {
  const localized = record(value);
  if (localized && Array.isArray(localized.blocks)) return localized as unknown as RichContent;
  const candidate = localized?.[locale] ?? localized?.vi ?? localized?.en;
  const rich = record(candidate);
  return rich && Array.isArray(rich.blocks) ? rich as unknown as RichContent : null;
}

function localizedOpportunity(value: unknown, locale: Locale): LocalizedOpportunity | null {
  const row = record(value);
  const title = record(row?.title);
  const description = localizedRichContent(row?.description, locale);
  if (!row || typeof row.id !== 'string' || typeof row.organization !== 'string' || !description) return null;
  const defaultLocale: Locale = typeof title?.vi === 'string' ? 'vi' : 'en';
  return {
    id: row.id,
    title: typeof row.title === 'string'
      ? row.title
      : resolveL10nString((title ?? {}) as { vi?: string; en?: string }, locale, defaultLocale),
    organization: row.organization,
    type: OPPORTUNITY_TYPES.includes(row.type as OpportunityForm['type']) ? row.type as OpportunityForm['type'] : 'external_program',
    description,
    eligibility: record(row.eligibility) ?? {},
    recommendedSkills: stringArray(row.recommended_skills),
    recommendedCourses: stringArray(row.recommended_courses),
    requiredCourses: stringArray(row.required_courses),
    applicationUrl: safeApplicationUrl(row.application_url),
    internalApplication: row.internal_application === true,
    openAt: nullableString(row.open_at),
    closeAt: nullableString(row.close_at),
    startAt: nullableString(row.start_at),
    endAt: nullableString(row.end_at),
    location: nullableString(row.location),
    online: row.online === true,
    featured: row.featured === true,
  };
}

function databaseRow(value: OpportunityForm) {
  return {
    id: value.id,
    title: value.title,
    organization: value.organization,
    type: value.type,
    description: value.description,
    eligibility: value.eligibility,
    recommended_skills: value.recommendedSkills,
    recommended_courses: value.recommendedCourses,
    required_courses: value.requiredCourses,
    application_url: value.applicationUrl,
    internal_application: value.internalApplication,
    open_at: value.openAt,
    close_at: value.closeAt,
    start_at: value.startAt,
    end_at: value.endAt,
    location: value.location,
    online: value.online,
    branch_scope: value.branchScope,
    featured: value.featured,
  };
}

function opportunityFormValue(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    organization: row.organization,
    type: row.type,
    description: row.description,
    eligibility: row.eligibility,
    recommendedSkills: row.recommended_skills,
    recommendedCourses: row.recommended_courses,
    requiredCourses: row.required_courses,
    applicationUrl: row.application_url,
    internalApplication: row.internal_application,
    openAt: row.open_at,
    closeAt: row.close_at,
    startAt: row.start_at,
    endAt: row.end_at,
    location: row.location,
    online: row.online,
    branchScope: row.branch_scope,
    featured: row.featured,
  };
}

function matchesOpportunityDraft(row: Record<string, unknown>, document: OpportunityForm): boolean {
  const parsed = OpportunityFormSchema.safeParse(opportunityFormValue(row));
  return parsed.success && isDeepStrictEqual(parsed.data, document);
}

function withBranchScope(query: OpportunityQuery, branchId: string | null): OpportunityQuery {
  if (!branchId) return query.eq('branch_scope->>scope', 'global');
  return query.or(`branch_scope->>scope.eq.global,branch_scope->branchIds.cs.${JSON.stringify([branchId])}`);
}

function withCombinedVisibility(
  query: OpportunityQuery,
  branchId: string | null,
  now?: Date,
): OpportunityQuery {
  const branch = branchId
    ? `or(branch_scope->>scope.eq.global,branch_scope->branchIds.cs.${JSON.stringify([branchId])})`
    : 'branch_scope->>scope.eq.global';
  const filters = [branch];
  if (now) {
    filters.push(
      `or(open_at.is.null,open_at.lte.${now.toISOString()})`,
      `or(close_at.is.null,close_at.gte.${now.toISOString()})`,
    );
  }
  return query.or(`and(${filters.join(',')})`);
}

export function opportunityFiltersFromUrl(url: string): OpportunityListFilter {
  const params = new URL(url).searchParams;
  // An empty param (`featured=` from an "any" option) is absent, as on the learner page.
  const booleanValue = (key: string) => {
    const value = params.get(key);
    if (value === null || value === '') return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new z.ZodError([{ code: 'custom', path: [key], message: `${key} must be true or false` }]);
  };
  const openNow = booleanValue('openNow');
  const featured = booleanValue('featured');
  return OpportunityListFilterSchema.parse({
    ...(params.get('type') ? { type: params.get('type') } : {}),
    ...(openNow !== undefined ? { openNow } : {}),
    ...(featured !== undefined ? { featured } : {}),
    ...(params.get('page') ? { page: params.get('page') } : {}),
  });
}

export function actorOpportunityPermissionCheck(actor: Actor, scope?: Scope): PermissionCheck {
  return async (permission) => {
    const genericEdit = permission === 'opportunity.edit' && hasPermission(actor, 'content.edit', scope);
    if (!genericEdit && !hasPermission(actor, permission, scope)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    return actor;
  };
}

export type RecommendationCandidate = {
  status: string;
  featured: boolean;
  openAt: string | null;
  closeAt: string | null;
  recommendedCourses: string[];
};

function isOpen(candidate: RecommendationCandidate, now: Date): boolean {
  return (!candidate.openAt || new Date(candidate.openAt) <= now)
    && (!candidate.closeAt || new Date(candidate.closeAt) >= now);
}

export function selectRecommendedOpportunity<T extends RecommendationCandidate>(
  opportunities: T[],
  completedCourseIds: string[],
  now = new Date(),
): T | undefined {
  const completed = new Set(completedCourseIds);
  const available = opportunities.filter((opportunity) =>
    opportunity.status === 'published' && opportunity.featured && isOpen(opportunity, now));
  return available.find((opportunity) => opportunity.recommendedCourses.some((courseId) => completed.has(courseId)))
    ?? available[0];
}

export function createOpportunityService({ database, requirePermission, scope }: Dependencies) {
  return {
    async saveDraft(raw: unknown, options: { unpublish?: boolean; createOnly?: boolean; expectedUpdatedAt?: string } = {}) {
      const actor = await requirePermission('opportunity.edit');
      const parsed = OpportunityFormSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError(400, 'INVALID_OPPORTUNITY', 'Opportunity validation failed', toValidationIssues(parsed.error.issues));
      const current = await database.from('opportunities')
        .select('*')
        .eq('id', parsed.data.id)
        .maybeSingle();
      if (current.error) databaseError('Opportunity could not be loaded');
      const existing = record(current.data);
      if (options.expectedUpdatedAt !== undefined
        && !(existing?.status === 'published' && !options.unpublish)
        && (!existing || !sameContentRevision('opportunity', typeof existing.updated_at === 'string' ? existing.updated_at : null, options.expectedUpdatedAt))) {
        draftConflict(parsed.data.id);
      }
      if (options.createOnly && existing) {
        if (existing.status === 'draft' && matchesOpportunityDraft(existing, parsed.data)) return existing;
        draftConflict(parsed.data.id);
      }
      const published = existing?.status === 'published';
      if (published && !options.unpublish) {
        const revision = typeof existing.updated_at === 'string' ? existing.updated_at : null;
        if (!revision) databaseError('Published opportunity revision is missing');
        const saved = await database.rpc('cms_save_content_draft', {
          p_actor_user_id: actor.userId,
          p_content_type: 'opportunity',
          p_content_id: parsed.data.id,
          p_expected_revision: options.expectedUpdatedAt ?? revision,
          p_source: { record: databaseRow(parsed.data) },
          p_audience: parsed.data.branchScope,
        });
        const failure = record(saved.error);
        if (failure?.code === '40001' || String(failure?.message ?? '').includes('CMS_REVISION_CHANGED')) draftConflict(parsed.data.id);
        if (String(failure?.message ?? '').includes('CMS_REVIEW_PENDING')) throw new ApiError(409, 'CMS_REVIEW_PENDING', 'Withdraw the pending review before editing');
        const acknowledgment = record(saved.data);
        if (saved.error || typeof acknowledgment?.revision_key !== 'string') databaseError('Opportunity draft could not be saved');
        return { ...acknowledgment, updated_at: isoRevisionTimestamp(acknowledgment.revision_key) };
      }
      if (published) await requirePermission('opportunity.publish');
      const draftRow = {
        ...databaseRow(parsed.data),
        updated_at: new Date().toISOString(),
        ...(!existing ? { status: 'draft', published_at: null, created_by: actor.userId } : {}),
        ...(published ? { status: 'draft', published_at: null } : {}),
      };
      if (options.createOnly) {
        const inserted = await database.from('opportunities')
          .insert(draftRow)
          .select('id,status,updated_at')
          .maybeSingle();
        if (!inserted.error && record(inserted.data)) return inserted.data;
        if (record(inserted.error)?.code !== '23505') databaseError('Opportunity draft could not be saved');
        const raced = await database.from('opportunities')
          .select('*')
          .eq('id', parsed.data.id)
          .maybeSingle();
        if (raced.error) databaseError('Opportunity could not be reloaded after a create conflict');
        const row = record(raced.data);
        if (row?.status === 'draft' && matchesOpportunityDraft(row, parsed.data)) return row;
        draftConflict(parsed.data.id);
      }
      if (options.expectedUpdatedAt !== undefined) {
        const { data, error } = await database.from('opportunities')
          .update(draftRow)
          .eq('id', parsed.data.id)
          .eq('updated_at', options.expectedUpdatedAt)
          .select('id,status,updated_at')
          .maybeSingle();
        if (!error && !record(data)) draftConflict(parsed.data.id);
        if (error || !record(data)) databaseError('Opportunity draft could not be saved');
        return data;
      }
      const { data, error } = await database.from('opportunities')
        .upsert(draftRow, { onConflict: 'id' })
        .select('id,status,updated_at')
        .single();
      if (error || !record(data)) databaseError('Opportunity draft could not be saved');
      return data;
    },

    async publish(id: string, options: {
      expectedDraft?: OpportunityForm;
      document?: unknown;
      expectedUpdatedAt?: string;
    } = {}) {
      const actor = await requirePermission('opportunity.publish');
      await requirePermission('opportunity.edit');
      const current = await database.from('opportunities').select('*').eq('id', id).maybeSingle();
      if (current.error) databaseError('Opportunity could not be loaded');
      const row = record(current.data);
      if (!row) notFound(id);
      const candidate = options.document ?? opportunityFormValue(row);
      const parsed = OpportunityFormSchema.safeParse(candidate);
      const legacyGuarded = options.expectedDraft !== undefined;
      const currentFormGuarded = options.document !== undefined || options.expectedUpdatedAt !== undefined;
      const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
      if (legacyGuarded && (
        row.status !== 'draft'
        || !updatedAt
        || !parsed.success
        || !isDeepStrictEqual(parsed.data, options.expectedDraft)
      )) draftConflict(id);
      if (!parsed.success) throw new ApiError(400, 'PUBLISH_VALIDATION_FAILED', 'Opportunity cannot be published', toValidationIssues(parsed.error.issues));
      if (parsed.data.id !== id) throw new ApiError(400, 'ID_MISMATCH', 'Opportunity id must match the route id');
      if (currentFormGuarded && (!updatedAt || updatedAt !== options.expectedUpdatedAt)) {
        if (row.status === 'published' && matchesOpportunityDraft(row, parsed.data)) return row;
        draftConflict(id);
      }
      if (row.status !== 'draft' && row.status !== 'published') draftConflict(id);
      const { data, error } = await database.rpc('cms_publish_content', {
        p_actor_user_id: actor.userId,
        p_content_type: 'opportunity',
        p_content_id: id,
        p_revision_key: options.expectedUpdatedAt ?? updatedAt,
      });
      const errorMessage = typeof record(error)?.message === 'string' ? String(record(error)?.message) : '';
      if (errorMessage.includes('CMS_APPROVED_REVIEW_REQUIRED')) throw new ApiError(409, 'CMS_REVIEW_REQUIRED', 'An approved Central review is required before publication');
      if (errorMessage.includes('CMS_STALE_REVIEW') || errorMessage.includes('CMS_REVISION_CHANGED')) draftConflict(id);
      if (error) databaseError('Opportunity could not be published');
      if (record(data)?.status === 'stale') throw new ApiError(409, 'CMS_STALE_REVIEW', 'The approved review no longer matches this opportunity draft');
      return {
        ...row,
        ...databaseRow(parsed.data),
        status: 'published',
        published_at: row.published_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },

    async listPage(filter: OpportunityListFilter, context: OpportunityContext): Promise<OpportunityPage> {
      const parsed = OpportunityListFilterSchema.parse(filter);
      const now = context.now ?? new Date();
      const page = parsed.page ?? 1;
      let query = database.from('opportunities').select('*', { count: 'exact' }).eq('status', 'published');
      if (parsed.type) query = query.eq('type', parsed.type);
      if (parsed.featured !== undefined) query = query.eq('featured', parsed.featured);
      query = excludeInternalContent(withCombinedVisibility(query, context.branchId, parsed.openNow ? now : undefined));
      const { data, error, count } = await query
        .order('featured', { ascending: false })
        .order('open_at', { ascending: false })
        .order('id', { ascending: true })
        .range((page - 1) * 50, page * 50 - 1);
      if (error) databaseError('Opportunities could not be listed');
      const items = Array.isArray(data)
        ? data.flatMap((value) => {
            const opportunity = localizedOpportunity(value, context.locale);
            return opportunity ? [opportunity] : [];
          })
        : [];
      return { items, total: typeof count === 'number' ? count : items.length, page, pageSize: 50 };
    },

    async list(filter: OpportunityListFilter, context: OpportunityContext) {
      return (await this.listPage(filter, context)).items;
    },

    async recommended(context: OpportunityContext) {
      const enrollments = await database.from('enrollments')
        .select('course_id,status')
        .eq('user_id', context.userId)
        .eq('status', 'completed');
      if (enrollments.error) databaseError('Completed courses could not be loaded');
      const completedCourseIds = Array.isArray(enrollments.data)
        ? enrollments.data.flatMap((value) => {
            const row = record(value);
            return typeof row?.course_id === 'string' ? [row.course_id] : [];
          })
        : [];
      const now = context.now ?? new Date();
      let query = database.from('opportunities')
        .select('*')
        .eq('status', 'published')
        .eq('featured', true);
      query = excludeInternalContent(withCombinedVisibility(query, context.branchId, now));
      const result = await query.order('open_at', { ascending: false }).range(0, 49);
      if (result.error) databaseError('Recommended opportunity could not be loaded');
      const candidates = Array.isArray(result.data)
        ? result.data.flatMap((value) => {
            const row = record(value);
            const opportunity = localizedOpportunity(value, context.locale);
            return row && opportunity ? [{
              ...opportunity,
              status: typeof row.status === 'string' ? row.status : 'published',
            }] : [];
          })
        : [];
      return selectRecommendedOpportunity(candidates, completedCourseIds, now);
    },

    async get(id: string, context: OpportunityContext) {
      let query = database.from('opportunities').select('*').eq('id', id).eq('status', 'published');
      query = withBranchScope(query, context.branchId);
      const opportunityResult = await query.maybeSingle();
      if (opportunityResult.error) databaseError('Opportunity could not be loaded');
      const opportunity = localizedOpportunity(opportunityResult.data, context.locale);
      if (!opportunity) notFound(id);

      const interestResult = await database.from('opportunity_interest')
        .select('opportunity_id')
        .eq('opportunity_id', id)
        .eq('user_id', context.userId)
        .maybeSingle();
      if (interestResult.error) databaseError('Opportunity interest could not be loaded');
      const courseIds = [...new Set([...opportunity.recommendedCourses, ...opportunity.requiredCourses])];
      let statuses: Array<{ courseId: string; status: string }> = [];
      if (courseIds.length > 0) {
        const enrollmentResult = await database.from('enrollments')
          .select('course_id,status')
          .eq('user_id', context.userId)
          .in('course_id', courseIds);
        if (enrollmentResult.error) databaseError('Course statuses could not be loaded');
        statuses = Array.isArray(enrollmentResult.data)
          ? enrollmentResult.data.flatMap((value) => {
              const row = record(value);
              return typeof row?.course_id === 'string' && typeof row.status === 'string'
                ? [{ courseId: row.course_id, status: row.status }]
                : [];
            })
          : [];
      }
      return { ...opportunity, interested: interestResult.data !== null, courseStatuses: statuses };
    },

    async setInterest(id: string, interested: boolean, context: OpportunityContext) {
      const parsedId = IdSchema.safeParse(id);
      if (!parsedId.success) throw new ApiError(400, 'INVALID_OPPORTUNITY_ID', 'Opportunity id is invalid');
      let opportunityQuery = database.from('opportunities')
        .select('id,internal_application,status')
        .eq('id', parsedId.data)
        .eq('status', 'published');
      opportunityQuery = withBranchScope(opportunityQuery, context.branchId);
      const opportunityResult = await opportunityQuery.maybeSingle();
      if (opportunityResult.error) databaseError('Opportunity could not be loaded');
      const opportunity = record(opportunityResult.data);
      if (!opportunity) notFound(id);
      if (opportunity.internal_application !== true) {
        throw new ApiError(409, 'EXTERNAL_APPLICATION', 'This opportunity uses an external application');
      }

      if (interested) {
        const { error } = await database.from('opportunity_interest')
          .upsert({
            opportunity_id: parsedId.data,
            user_id: context.userId,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'opportunity_id,user_id' })
          .select('opportunity_id,user_id')
          .single();
        if (error) databaseError('Opportunity interest could not be saved');
      } else {
        const { error } = await database.from('opportunity_interest')
          .delete()
          .eq('opportunity_id', parsedId.data)
          .eq('user_id', context.userId);
        if (error) databaseError('Opportunity interest could not be removed');
      }
      return { interested };
    },

    async listStudio(page = 1) {
      await requirePermission('opportunity.edit');
      const parsedPage = z.number().int().min(1).max(10_000).parse(page);
      let query = database.from('opportunities').select('*');
      if (scope?.kind === 'branch') query = query.eq('ownership_kind', 'branch').eq('owner_branch_id', scope.branchId);
      const { data, error } = await query
        .order('updated_at', { ascending: false })
        .range((parsedPage - 1) * 50, parsedPage * 50 - 1);
      if (error) databaseError('Opportunity drafts could not be listed');
      return Array.isArray(data) ? data : [];
    },

    async getStudio(id: string) {
      const actor = await requirePermission('opportunity.edit');
      const { data, error } = await database.from('opportunities').select('*').eq('id', id).maybeSingle();
      if (error) databaseError('Opportunity could not be loaded');
      const liveRow = record(data);
      if (!liveRow) notFound(id);
      if (liveRow.status === 'published') {
        const candidateResult = await database.rpc('cms_get_editor_content', {
          p_actor_user_id: actor.userId,
          p_content_type: 'opportunity',
          p_content_id: id,
        });
        if (candidateResult.error) databaseError('Opportunity draft could not be loaded');
        const candidate = record(candidateResult.data);
        const draftRecord = record(record(candidate?.source)?.record);
        if (candidate?.has_draft === true && draftRecord && typeof candidate.revision_key === 'string') {
          return { ...liveRow, ...draftRecord, status: 'draft', published_at: liveRow.published_at, updated_at: isoRevisionTimestamp(candidate.revision_key) };
        }
      }
      return liveRow;
    },
  };
}
