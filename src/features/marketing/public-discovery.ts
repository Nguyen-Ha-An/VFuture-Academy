import 'server-only';

import { unstable_cache } from 'next/cache';

import { resolveL10nString, type Locale, type MediaRef } from '@/content-engine';
import { ResourceDocumentSchema, type ResourceDocument } from '@/content-engine/schema/bundle';
import type { RichContent } from '@/content-engine/schema/types';
import { OPPORTUNITY_TYPES, safeApplicationUrl, type OpportunityForm } from '@/features/opportunities/schema';
import type { ProjectStatus } from '@/features/projects/service';
import { ApiError } from '@/lib/api';
import { excludeInternalContent, internalContentFingerprint, isInternalContentId, withoutInternalContent } from '@/lib/internal-content';
import { supabaseService } from '@/lib/supabase/server';
import { PUBLIC_CACHE_TAGS } from './public-cache';

type QueryResult = { data: unknown; error: unknown | null; count?: number | null };
export interface PublicDiscoveryQuery extends PromiseLike<QueryResult> {
  select(columns: string, options?: { count?: 'exact' }): this;
  eq(column: string, value: unknown): this;
  in(column: string, values: unknown[]): this;
  contains(column: string, value: unknown): this;
  textSearch(column: string, value: string, options?: unknown): this;
  lte(column: string, value: unknown): this;
  gte(column: string, value: unknown): this;
  or(filters: string): this;
  not(column: string, operator: string, value: string): this;
  order(column: string, options?: { ascending?: boolean }): this;
  range(from: number, to: number): this;
  maybeSingle(): Promise<QueryResult>;
}
export interface PublicDiscoveryDatabase { from(table: string): PublicDiscoveryQuery }

export type PublicPage<T> = { items: T[]; total: number; page: number; pageSize: number };
export type PublicResource = {
  id: string; title: string; summary: string; resourceType: ResourceDocument['resourceType'];
  tags: string[]; skills: string[]; pathways: string[]; publishedAt: string | null;
};
export type PublicResourceDetail = PublicResource & {
  body: RichContent;
  attachments: Array<{ src: MediaRef; label: string }>;
};
export type PublicOpportunity = {
  id: string; title: string; organization: string; type: OpportunityForm['type'];
  description: RichContent; recommendedSkills: string[]; recommendedCourses: string[];
  requiredCourses: string[]; applicationUrl: string | null; internalParticipation: boolean;
  openAt: string | null; closeAt: string | null; startAt: string | null; endAt: string | null;
  location: string | null; online: boolean; featured: boolean; publishedAt: string | null;
};
export type PublicProject = {
  id: string; title: string; summary: string; status: ProjectStatus; skills: string[];
  courseIds: string[]; coverAssetId: string | null; createdAt: string; updatedAt: string;
};
export type PublicProjectDetail = PublicProject & { outputLinks: Array<{ label: string; url: string }> };

export type PublicResourceFilters = { type?: ResourceDocument['resourceType']; tag?: string; pathway?: string; search?: string; page?: number; pageSize?: number };
export type PublicOpportunityFilters = { type?: OpportunityForm['type']; openNow?: boolean; featured?: boolean; page?: number; pageSize?: number };
export type PublicProjectFilters = { skill?: string; course?: string; page?: number; pageSize?: number };

const REVALIDATE_SECONDS = 300;
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function rows(value: unknown) { return Array.isArray(value) ? value.flatMap((value) => record(value) ? [record(value)!] : []) : []; }
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function nullableString(value: unknown) { return typeof value === 'string' ? value : null; }
function databaseError(kind: string): never { throw new ApiError(503, 'PUBLIC_READ_UNAVAILABLE', `${kind} are temporarily unavailable`); }
function paging(page = 1, pageSize = 12) {
  const safePage = Number.isInteger(page) ? Math.min(Math.max(page, 1), 10_000) : 1;
  const safeSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 50) : 12;
  return { page: safePage, pageSize: safeSize, from: (safePage - 1) * safeSize, to: safePage * safeSize - 1 };
}

async function publicPageQuery(query: PublicDiscoveryQuery, page: ReturnType<typeof paging>, kind: string): Promise<QueryResult> {
  const result = await query.range(page.from, page.to);
  if (!result.error) return result;
  if (page.from === 0 || record(result.error)?.code !== 'PGRST103') databaseError(kind);

  // PostgREST returns 416 beyond the final row; supabase-js omits count on that
  // error. Reuse every public filter/projection and fetch at most one row to
  // recover the exact total, so page callers can redirect to the last page.
  const first = await query.range(0, 0);
  if (first.error || typeof first.count !== 'number' || !Number.isSafeInteger(first.count) || first.count < 0) databaseError(kind);
  if (first.count <= page.from) return { data: [], error: null, count: first.count };

  // Publication may have grown the catalog between requests. Re-read the
  // requested page once; repeated failures remain an explicit outage.
  const refreshed = await query.range(page.from, page.to);
  if (refreshed.error) databaseError(kind);
  return refreshed;
}
function localized(value: unknown, locale: Locale) {
  if (typeof value === 'string') return value;
  const map = record(value) ?? {};
  const fallback: Locale = typeof map.vi === 'string' ? 'vi' : 'en';
  return resolveL10nString(map as { vi?: string; en?: string }, locale, fallback);
}
function localizedRich(value: unknown, locale: Locale): RichContent | null {
  const map = record(value);
  const candidate = Array.isArray(map?.blocks) ? map : record(map?.[locale] ?? map?.vi ?? map?.en);
  return candidate && Array.isArray(candidate.blocks) ? candidate as unknown as RichContent : null;
}
function isGlobalScope(value: unknown) { return record(value)?.scope === 'global'; }
function resourceOf(value: unknown, locale: Locale): PublicResourceDetail | null {
  const row = record(value);
  const parsed = ResourceDocumentSchema.safeParse(row?.document);
  if (!row || row.status !== 'published' || !isGlobalScope(row.branch_scope) || !parsed.success) return null;
  const document = parsed.data;
  const defaultLocale = document.defaultLanguage ?? document.languages?.[0] ?? 'vi';
  const bodyValue = 'blocks' in document.body ? document.body : document.body[locale] ?? document.body[defaultLocale] ?? document.body.vi ?? document.body.en;
  if (!bodyValue) return null;
  return {
    id: document.id,
    title: resolveL10nString(document.title, locale, defaultLocale),
    summary: resolveL10nString(document.summary, locale, defaultLocale),
    resourceType: document.resourceType,
    tags: document.tags ?? [], skills: document.skills ?? [], pathways: document.pathways ?? [],
    publishedAt: nullableString(row.published_at), body: bodyValue,
    attachments: (document.attachments ?? []).map((item) => ({ src: item.src, label: resolveL10nString(item.label, locale, defaultLocale) })),
  };
}
function opportunityOf(value: unknown, locale: Locale): PublicOpportunity | null {
  const row = record(value);
  const description = localizedRich(row?.description, locale);
  if (!row || row.status !== 'published' || !isGlobalScope(row.branch_scope) || typeof row.id !== 'string' || typeof row.organization !== 'string' || !description) return null;
  return {
    id: row.id, title: localized(row.title, locale), organization: row.organization,
    type: OPPORTUNITY_TYPES.includes(row.type as OpportunityForm['type']) ? row.type as OpportunityForm['type'] : 'external_program',
    description, recommendedSkills: strings(row.recommended_skills), recommendedCourses: strings(row.recommended_courses),
    requiredCourses: strings(row.required_courses), applicationUrl: safeApplicationUrl(row.application_url),
    internalParticipation: row.internal_application === true, openAt: nullableString(row.open_at), closeAt: nullableString(row.close_at),
    startAt: nullableString(row.start_at), endAt: nullableString(row.end_at), location: nullableString(row.location),
    online: row.online === true, featured: row.featured === true, publishedAt: nullableString(row.published_at),
  };
}
const PROJECT_STATUSES = new Set<ProjectStatus>(['idea', 'forming', 'active', 'completed', 'showcased']);
function projectOf(value: unknown, locale: Locale): PublicProjectDetail | null {
  const row = record(value);
  if (!row || row.approved !== true || !isGlobalScope(row.branch_scope) || typeof row.id !== 'string' || !PROJECT_STATUSES.has(row.status as ProjectStatus)) return null;
  const links = Array.isArray(row.output_links) ? row.output_links.flatMap((value) => {
    const link = record(value);
    const url = typeof link?.url === 'string' ? safeApplicationUrl(link.url) : null;
    return url ? [{ label: localized(link?.label, locale), url }] : [];
  }) : [];
  return {
    id: row.id, title: localized(row.title, locale), summary: localized(row.summary, locale), status: row.status as ProjectStatus,
    skills: strings(row.skills), courseIds: strings(row.course_ids), coverAssetId: nullableString(row.cover_asset_id),
    createdAt: nullableString(row.created_at) ?? '', updatedAt: nullableString(row.updated_at) ?? '', outputLinks: links,
  };
}

async function publicCourseIds(database: PublicDiscoveryDatabase, courseIds: string[]): Promise<Set<string>> {
  if (!courseIds.length) return new Set();
  const courseResult = await database.from('courses').select('id,current_version_id,status').in('id', courseIds).eq('status', 'published');
  if (courseResult.error) databaseError('Public project courses');
  const current = new Map(rows(courseResult.data).flatMap((course) => course.status === 'published' && typeof course.id === 'string' && typeof course.current_version_id === 'string' ? [[course.current_version_id, course.id] as const] : []));
  if (!current.size) return new Set();
  const outlineResult = await database.from('course_version_outline').select('version_id,access').in('version_id', [...current.keys()]).eq('access->>scope', 'global');
  if (outlineResult.error) databaseError('Public project courses');
  return new Set(rows(outlineResult.data).flatMap((outline) => typeof outline.version_id === 'string' && record(outline.access)?.scope === 'global' && current.has(outline.version_id) ? [current.get(outline.version_id)!] : []));
}

export function createPublicDiscoveryService(database: PublicDiscoveryDatabase) {
  return {
    async listResources(locale: Locale, filters: PublicResourceFilters = {}): Promise<PublicPage<PublicResource>> {
      const p = paging(filters.page, filters.pageSize);
      let query = database.from('resources').select('id,document,published_at,status,branch_scope', { count: 'exact' })
        .eq('status', 'published').eq('branch_scope->>scope', 'global');
      // The SQL guard keeps `total` exact; the cached-value filter below is the backstop.
      query = excludeInternalContent(query);
      if (filters.type) query = query.eq('document->>resourceType', filters.type);
      if (filters.tag) query = query.contains('document', { tags: [filters.tag] });
      if (filters.pathway) query = query.contains('document', { pathways: [filters.pathway] });
      if (filters.search) query = query.textSearch('search', filters.search, { config: 'simple', type: 'websearch' });
      const result = await publicPageQuery(query.order('published_at', { ascending: false }), p, 'Public resources');
      return { items: rows(result.data).flatMap((row) => { const item = resourceOf(row, locale); if (!item) return []; const { body: _body, attachments: _attachments, ...summary } = item; return [summary]; }), total: result.count ?? rows(result.data).length, page: p.page, pageSize: p.pageSize };
    },
    async getResource(id: string, locale: Locale): Promise<PublicResourceDetail | null> {
      const result = await database.from('resources').select('id,document,published_at,status,branch_scope').eq('id', id).eq('status', 'published').eq('branch_scope->>scope', 'global').maybeSingle();
      if (result.error) databaseError('Public resource');
      return resourceOf(result.data, locale);
    },
    async listOpportunities(locale: Locale, filters: PublicOpportunityFilters = {}): Promise<PublicPage<PublicOpportunity>> {
      const p = paging(filters.page, filters.pageSize);
      let query = database.from('opportunities').select('id,title,organization,type,description,recommended_skills,recommended_courses,required_courses,application_url,internal_application,open_at,close_at,start_at,end_at,location,online,featured,published_at,status,branch_scope', { count: 'exact' }).eq('status', 'published').eq('branch_scope->>scope', 'global');
      query = excludeInternalContent(query);
      if (filters.type) query = query.eq('type', filters.type);
      if (filters.featured !== undefined) query = query.eq('featured', filters.featured);
      if (filters.openNow) {
        const now = new Date().toISOString();
        query = query.or(`and(or(open_at.is.null,open_at.lte.${now}),or(close_at.is.null,close_at.gte.${now}))`);
      }
      const result = await publicPageQuery(query.order('published_at', { ascending: false }), p, 'Public opportunities');
      return { items: rows(result.data).flatMap((row) => { const item = opportunityOf(row, locale); return item ? [item] : []; }), total: result.count ?? rows(result.data).length, page: p.page, pageSize: p.pageSize };
    },
    async getOpportunity(id: string, locale: Locale): Promise<PublicOpportunity | null> {
      const result = await database.from('opportunities').select('id,title,organization,type,description,recommended_skills,recommended_courses,required_courses,application_url,internal_application,open_at,close_at,start_at,end_at,location,online,featured,published_at,status,branch_scope').eq('id', id).eq('status', 'published').eq('branch_scope->>scope', 'global').maybeSingle();
      if (result.error) databaseError('Public opportunity');
      return opportunityOf(result.data, locale);
    },
    async listProjects(locale: Locale, filters: PublicProjectFilters = {}): Promise<PublicPage<PublicProject>> {
      const p = paging(filters.page, filters.pageSize);
      if (filters.course && (isInternalContentId(filters.course) || !(await publicCourseIds(database, [filters.course])).has(filters.course))) return { items: [], total: 0, page: p.page, pageSize: p.pageSize };
      let query = database.from('projects').select('id,title,summary,status,skills,course_ids,cover_asset_id,created_at,updated_at,approved,branch_scope', { count: 'exact' }).eq('approved', true).eq('branch_scope->>scope', 'global');
      query = excludeInternalContent(query);
      if (filters.skill) query = query.contains('skills', [filters.skill]);
      if (filters.course) query = query.contains('course_ids', [filters.course]);
      const result = await publicPageQuery(query.order('updated_at', { ascending: false }), p, 'Public projects');
      const parsed = rows(result.data).flatMap((row) => { const item = projectOf(row, locale); return item ? [item] : []; });
      const allowedCourses = await publicCourseIds(database, [...new Set(parsed.flatMap(({ courseIds }) => courseIds))]);
      return { items: parsed.map((item) => { const { outputLinks: _links, ...summary } = item; return { ...summary, courseIds: summary.courseIds.filter((id) => allowedCourses.has(id)) }; }), total: result.count ?? rows(result.data).length, page: p.page, pageSize: p.pageSize };
    },
    async getProject(id: string, locale: Locale): Promise<PublicProjectDetail | null> {
      const result = await database.from('projects').select('id,title,summary,status,output_links,skills,course_ids,cover_asset_id,created_at,updated_at,approved,branch_scope').eq('id', id).eq('approved', true).eq('branch_scope->>scope', 'global').maybeSingle();
      if (result.error) databaseError('Public project');
      const project = projectOf(result.data, locale);
      if (!project) return null;
      const allowedCourses = await publicCourseIds(database, project.courseIds);
      return { ...project, courseIds: project.courseIds.filter((courseId) => allowedCourses.has(courseId)) };
    },
  };
}

function production() { return createPublicDiscoveryService(supabaseService() as unknown as PublicDiscoveryDatabase); }
// The fingerprint keeps entries cached under one fixture policy from serving the other.
const internalKey = internalContentFingerprint();
const cachedResources = unstable_cache((locale: Locale, filters: PublicResourceFilters) => production().listResources(locale, filters), ['public-resources', internalKey], { revalidate: REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.resources] });
const cachedResource = unstable_cache((id: string, locale: Locale) => production().getResource(id, locale), ['public-resource', internalKey], { revalidate: REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.resources] });
const cachedOpportunities = unstable_cache((locale: Locale, filters: PublicOpportunityFilters) => production().listOpportunities(locale, filters), ['public-opportunities', internalKey], { revalidate: REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.opportunities] });
const cachedOpportunity = unstable_cache((id: string, locale: Locale) => production().getOpportunity(id, locale), ['public-opportunity', internalKey], { revalidate: REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.opportunities] });
const cachedProjects = unstable_cache((locale: Locale, filters: PublicProjectFilters) => production().listProjects(locale, filters), ['public-projects', internalKey], { revalidate: REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.projects, PUBLIC_CACHE_TAGS.courses] });
const cachedProject = unstable_cache((id: string, locale: Locale) => production().getProject(id, locale), ['public-project', internalKey], { revalidate: REVALIDATE_SECONDS, tags: [PUBLIC_CACHE_TAGS.projects, PUBLIC_CACHE_TAGS.courses] });

// The fixture guard runs on the value returned from the cache, never inside it,
// so a cache warmed before HIDE_INTERNAL_CONTENT was set cannot re-surface fixtures.
// The list queries also exclude fixtures in SQL (under the same fingerprint), so `total` stays exact.
function withoutInternalItems<T extends { id: string }>(page: PublicPage<T>): PublicPage<T> {
  return { ...page, items: withoutInternalContent(page.items, (item) => item.id) };
}
function withoutInternalCourses<T extends { courseIds: string[] }>(project: T): T {
  return { ...project, courseIds: withoutInternalContent(project.courseIds, (id) => id) };
}

export const listPublicResources = async (locale: Locale, filters: PublicResourceFilters = {}) => withoutInternalItems(await cachedResources(locale, filters));
export const getPublicResource = async (id: string, locale: Locale) => isInternalContentId(id) ? null : cachedResource(id, locale);
export const listPublicOpportunities = async (locale: Locale, filters: PublicOpportunityFilters = {}) => withoutInternalItems(await cachedOpportunities(locale, filters));
export const getPublicOpportunity = async (id: string, locale: Locale) => isInternalContentId(id) ? null : cachedOpportunity(id, locale);
export const listPublicProjects = async (locale: Locale, filters: PublicProjectFilters = {}) => {
  const page = withoutInternalItems(await cachedProjects(locale, filters));
  return { ...page, items: page.items.map(withoutInternalCourses) };
};
export const getPublicProject = async (id: string, locale: Locale) => {
  const project = isInternalContentId(id) ? null : await cachedProject(id, locale);
  return project && withoutInternalCourses(project);
};
