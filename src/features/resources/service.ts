import 'server-only';
import { isoRevisionTimestamp, sameContentRevision } from '@/features/content-review/revision';

import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import { resolveL10nString, type Locale } from '@/content-engine';
import {
  RESOURCE_TYPES,
  ResourceDocumentSchema,
  type ResourceDocument,
} from '@/content-engine/schema/bundle';
import { PATHWAYS } from '@/content-engine/schema/course';
import type { RichContent } from '@/content-engine/schema/types';
import { validateStandaloneDocument } from '@/content-engine/validate';
import { ApiError, toValidationIssues } from '@/lib/api';
import { excludeInternalContent } from '@/lib/internal-content';
import { audit } from '@/lib/audit';
import { hasPermission, type Actor, type Permission, type Scope } from '@/lib/permissions';
import { SupabaseResolver, type SupabaseQueryClient } from '@/features/studio/resolver';
import type { ReferenceResolver } from '@/content-engine/validate';

type QueryResult = { data: unknown; error: unknown | null; count?: number | null };

export interface ResourceQuery extends PromiseLike<QueryResult> {
  select(columns: string, options?: { count?: 'exact'; head?: boolean }): this;
  eq(column: string, value: unknown): this;
  contains(column: string, value: unknown): this;
  or(value: string): this;
  not(column: string, operator: string, value: string): this;
  textSearch(column: string, value: string, options?: unknown): this;
  order(column: string, options?: unknown): this;
  limit(value: number): this;
  range(from: number, to: number): this;
  insert(value: unknown): this;
  upsert(value: unknown, options?: unknown): this;
  update(value: unknown): this;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

export interface ResourceDatabase {
  from(table: string): ResourceQuery;
  rpc(name: string, args?: Record<string, unknown>): Promise<QueryResult>;
}

type ResourcePermission = Extract<Permission, 'resource.edit' | 'resource.publish'>;
type PermissionCheck = (permission: ResourcePermission) => Promise<Actor>;

export type ResourceContext = {
  userId?: string;
  branchId: string | null;
  locale: Locale;
};

export const ResourceListFilterSchema = z.object({
  type: z.enum(RESOURCE_TYPES).optional(),
  tag: z.string().trim().min(1).max(40).optional(),
  pathway: z.enum(PATHWAYS).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
}).strict();

export type ResourceListFilter = z.infer<typeof ResourceListFilterSchema>;

export type LocalizedResource = {
  id: string;
  title: string;
  summary: string;
  resourceType: ResourceDocument['resourceType'];
  tags: string[];
  skills: string[];
  pathways: string[];
  body: RichContent;
  attachments: Array<{ src: NonNullable<ResourceDocument['attachments']>[number]['src']; label: string }>;
  publishedAt: string | null;
};

export type ResourcePage = { items: LocalizedResource[]; total: number; page: number; pageSize: 50 };
export type StudioResourceStatus = 'draft' | 'published' | 'archived';
export type StudioResourceRecord = {
  id: string;
  document: ResourceDocument;
  status: StudioResourceStatus;
  ownerId: string;
  publishedAt: string | null;
  updatedAt: string;
};

type Dependencies = {
  database: ResourceDatabase;
  requirePermission: PermissionCheck;
  resolver?: ReferenceResolver;
  scope?: Scope;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function databaseError(message: string): never {
  throw new ApiError(500, 'RESOURCE_DATABASE_ERROR', message);
}

function notFound(id: string): never {
  throw new ApiError(404, 'RESOURCE_NOT_FOUND', `Resource "${id}" was not found`);
}

function draftConflict(id: string): never {
  throw new ApiError(409, 'RESOURCE_DRAFT_CONFLICT', `Resource "${id}" changed before it could be published`);
}

function studioRecord(value: unknown): StudioResourceRecord | null {
  const row = record(value);
  const document = ResourceDocumentSchema.safeParse(row?.document);
  if (!row || !document.success || document.data.id !== row.id
    || !['draft', 'published', 'archived'].includes(String(row.status))
    || typeof row.owner_id !== 'string' || typeof row.updated_at !== 'string') return null;
  return {
    id: row.id as string,
    document: document.data,
    status: row.status as StudioResourceStatus,
    ownerId: row.owner_id,
    publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
    updatedAt: isoRevisionTimestamp(row.updated_at),
  };
}

function localizedRichContent(
  value: ResourceDocument['body'],
  locale: Locale,
  defaultLocale: Locale,
): RichContent | null {
  if ('blocks' in value) return value;
  return value[locale] ?? value[defaultLocale] ?? value.vi ?? value.en ?? null;
}

function localizedResource(rowValue: unknown, locale: Locale): LocalizedResource | null {
  const row = record(rowValue);
  const parsed = ResourceDocumentSchema.safeParse(row?.document);
  if (!row || !parsed.success) return null;
  const document = parsed.data;
  const defaultLocale = document.defaultLanguage ?? document.languages?.[0] ?? 'vi';
  const body = localizedRichContent(document.body, locale, defaultLocale);
  if (!body) return null;
  return {
    id: document.id,
    title: resolveL10nString(document.title, locale, defaultLocale),
    summary: resolveL10nString(document.summary, locale, defaultLocale),
    resourceType: document.resourceType,
    tags: document.tags ?? [],
    skills: document.skills ?? [],
    pathways: document.pathways ?? [],
    body,
    attachments: (document.attachments ?? []).map((attachment) => ({
      src: attachment.src,
      label: resolveL10nString(attachment.label, locale, defaultLocale),
    })),
    publishedAt: typeof row.published_at === 'string' ? row.published_at : null,
  };
}

function splitValues(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
}

export function resourceFiltersFromUrl(url: string): ResourceListFilter {
  const params = new URL(url).searchParams;
  const types = splitValues(params.getAll('type'));
  const tags = splitValues(params.getAll('tag'));
  const pathways = splitValues(params.getAll('pathway'));
  return ResourceListFilterSchema.parse({
    ...(types[0] ? { type: types[0] } : {}),
    ...(tags[0] ? { tag: tags[0] } : {}),
    ...(pathways[0] ? { pathway: pathways[0] } : {}),
    ...(params.get('search')?.trim() ? { search: params.get('search')?.trim() } : {}),
    ...(params.has('page') ? { page: params.get('page') } : {}),
  });
}

async function validatedResource(
  raw: unknown,
  resolver: ReferenceResolver,
  errorCode = 'INVALID_RESOURCE',
): Promise<ResourceDocument> {
  const hintedId = record(raw)?.id;
  const result = await validateStandaloneDocument(
    raw,
    typeof hintedId === 'string' ? hintedId : 'resource',
    resolver,
  );
  const parsed = ResourceDocumentSchema.safeParse(result.doc);
  if (!result.ok || !parsed.success) {
    const issues = result.report.errors.length > 0
      ? result.report.errors
      : parsed.success ? [] : parsed.error.issues;
    throw new ApiError(400, errorCode, 'Resource validation failed', toValidationIssues(issues));
  }
  const branchScope = parsed.data.branchScope ?? { scope: 'global' as const };
  if (branchScope.scope === 'branches') {
    const exists = await Promise.all(branchScope.branchIds.map((id) => resolver.branchExists(id)));
    const issues = exists.flatMap((found, index) => found ? [] : [{
      path: ['branchScope', 'branchIds', index],
      message: `Unknown branch: ${branchScope.branchIds[index]}`,
    }]);
    if (issues.length > 0) {
      throw new ApiError(400, errorCode, 'Resource validation failed', issues);
    }
  }
  return { ...parsed.data, branchScope };
}

export function actorResourcePermissionCheck(actor: Actor, scope?: Scope): PermissionCheck {
  return async (permission) => {
    const genericEdit = permission === 'resource.edit' && hasPermission(actor, 'content.edit', scope);
    if (!genericEdit && !hasPermission(actor, permission, scope)) throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    return actor;
  };
}

function withBranchScope(query: ResourceQuery, branchId: string | null): ResourceQuery {
  if (!branchId) return query.eq('branch_scope->>scope', 'global');
  return query.or(`branch_scope->>scope.eq.global,branch_scope->branchIds.cs.${JSON.stringify([branchId])}`);
}

export function createResourceService({ database, requirePermission, resolver, scope }: Dependencies) {
  const referenceResolver = resolver
    ?? new SupabaseResolver(database as unknown as SupabaseQueryClient);
  return {
    async validate(id: string, raw: unknown) {
      await requirePermission('resource.edit');
      const document = await validatedResource(raw, referenceResolver);
      if (document.id !== id) throw new ApiError(400, 'ID_MISMATCH', 'Resource id must match the route id');
      return { document };
    },

    async saveDraft(raw: unknown, options: { unpublish?: boolean; createOnly?: boolean; expectedUpdatedAt?: string } = {}) {
      const actor = await requirePermission('resource.edit');
      const document = await validatedResource(raw, referenceResolver);
      const current = await database.from('resources')
        .select('id,status,published_at,owner_id,document,updated_at,ownership_kind,owner_branch_id')
        .eq('id', document.id)
        .maybeSingle();
      if (current.error) databaseError('Resource could not be loaded');
      const existing = record(current.data);
      const ownershipKind = scope?.kind ?? 'central';
      const ownerBranchId = scope?.kind === 'branch' ? scope.branchId : null;
      const isCreateReplay = (row: Record<string, unknown> | null) => row?.status === 'draft'
        && row.owner_id === actor.userId
        && row.ownership_kind === ownershipKind
        && row.owner_branch_id === ownerBranchId
        && isDeepStrictEqual(row.document, document);
      const auditCreation = () => audit(actor, 'resource.create', { type: 'resource', id: document.id }, null, {
        status: 'draft', ownershipKind, ownerBranchId,
      });
      if (options.createOnly && existing) {
        if (isCreateReplay(existing)) return existing;
        draftConflict(document.id);
      }
      const published = existing?.status === 'published';
      if (published && !options.unpublish) {
        const revision = typeof existing.updated_at === 'string' ? existing.updated_at : null;
        if (!revision) databaseError('Published resource revision is missing');
        const saved = await database.rpc('cms_save_content_draft', {
          p_actor_user_id: actor.userId,
          p_content_type: 'resource',
          p_content_id: document.id,
          p_expected_revision: options.expectedUpdatedAt ?? revision,
          p_source: { document },
          p_audience: document.branchScope,
        });
        const failure = record(saved.error);
        if (failure?.code === '40001' || String(failure?.message ?? '').includes('CMS_REVISION_CHANGED')) draftConflict(document.id);
        if (String(failure?.message ?? '').includes('CMS_REVIEW_PENDING')) throw new ApiError(409, 'CMS_REVIEW_PENDING', 'Withdraw the pending review before editing');
        const acknowledgment = record(saved.data);
        if (saved.error || typeof acknowledgment?.revision_key !== 'string') databaseError('Resource draft could not be saved');
        const draft = studioRecord({ ...existing, document, status: 'draft', updated_at: acknowledgment.revision_key });
        if (!draft) databaseError('Resource draft acknowledgment is incomplete');
        return { ...acknowledgment, ...draft };
      }
      if (published) await requirePermission('resource.publish');
      if (existing && options.expectedUpdatedAt !== undefined && !sameContentRevision('resource', typeof existing.updated_at === 'string' ? existing.updated_at : null, options.expectedUpdatedAt)) draftConflict(document.id);
      const now = new Date().toISOString();
      const draftRow = {
        id: document.id,
        document,
        branch_scope: document.branchScope,
        updated_at: now,
        ...(!existing ? {
          status: 'draft', owner_id: actor.userId, published_at: null,
          ownership_kind: ownershipKind, owner_branch_id: ownerBranchId,
        } : {}),
        ...(published ? { status: 'draft', published_at: null } : {}),
      };
      if (options.createOnly) {
        const inserted = await database.from('resources')
          .insert(draftRow)
          .select('id,document,status,owner_id,published_at,updated_at')
          .maybeSingle();
        const created = studioRecord(inserted.data);
        if (!inserted.error && created) {
          await auditCreation();
          return created;
        }
        if (record(inserted.error)?.code !== '23505') databaseError('Resource draft could not be saved');
        const raced = await database.from('resources')
          .select('id,document,status,owner_id,published_at,updated_at,ownership_kind,owner_branch_id')
          .eq('id', document.id)
          .maybeSingle();
        if (raced.error) databaseError('Resource could not be reloaded after a create conflict');
        const row = record(raced.data);
        const recovered = studioRecord(row);
        if (recovered && isCreateReplay(row)) return recovered;
        draftConflict(document.id);
      }
      if (existing) {
        let update = database.from('resources').update(draftRow).eq('id', document.id);
        if (options.expectedUpdatedAt !== undefined) update = update.eq('updated_at', options.expectedUpdatedAt);
        update = published ? update.eq('status', 'published') : update.eq('status', 'draft');
        const { data, error } = await update
          .select('id,document,status,owner_id,published_at,updated_at').maybeSingle();
        if (error) databaseError('Resource draft could not be saved');
        const saved = studioRecord(data);
        if (saved) return saved;
        if (options.expectedUpdatedAt === undefined && record(data)) return data;
        draftConflict(document.id);
      }
      const { data, error } = await database.from('resources')
        .insert(draftRow)
        .select('id,document,status,owner_id,published_at,updated_at').single();
      if (error) databaseError('Resource draft could not be saved');
      const saved = studioRecord(data);
      if (saved || record(data)) {
        await auditCreation();
        return saved ?? data;
      }
      databaseError('Resource draft could not be saved');
    },

    async publish(id: string, options?: { document?: unknown; expectedUpdatedAt?: string; expectedDraft?: ResourceDocument }) {
      await requirePermission('resource.edit');
      const actor = await requirePermission('resource.publish');
      const current = await database.from('resources')
        .select('id,document,status,owner_id,published_at,updated_at')
        .eq('id', id)
        .maybeSingle();
      if (current.error) databaseError('Resource could not be loaded');
      const row = record(current.data);
      if (!row) notFound(id);
      const requested = await validatedResource(options?.document ?? options?.expectedDraft ?? row.document, referenceResolver, 'PUBLISH_VALIDATION_FAILED');
      if (requested.id !== id) throw new ApiError(400, 'ID_MISMATCH', 'Resource id must match the route id');
      const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
      if ((row.status !== 'draft' && row.status !== 'published') || (options && !updatedAt)) draftConflict(id);
      if (options?.expectedDraft && (row.status !== 'draft' || !isDeepStrictEqual(row.document, options.expectedDraft))) draftConflict(id);
      if (options?.expectedUpdatedAt && updatedAt !== options.expectedUpdatedAt) {
        if (row.status === 'published' && isDeepStrictEqual(row.document, requested)) {
          const replay = studioRecord(row);
          if (replay) return replay;
        }
        draftConflict(id);
      }
      const { data, error } = await database.rpc('cms_publish_content', {
        p_actor_user_id: actor.userId,
        p_content_type: 'resource',
        p_content_id: id,
        p_revision_key: options?.expectedUpdatedAt ?? updatedAt,
      });
      const errorMessage = typeof record(error)?.message === 'string' ? String(record(error)?.message) : '';
      if (errorMessage.includes('CMS_APPROVED_REVIEW_REQUIRED')) throw new ApiError(409, 'CMS_REVIEW_REQUIRED', 'An approved Central review is required before publication');
      if (errorMessage.includes('CMS_STALE_REVIEW') || errorMessage.includes('CMS_REVISION_CHANGED')) draftConflict(id);
      if (error) databaseError('Resource could not be published');
      if (record(data)?.status === 'stale') throw new ApiError(409, 'CMS_STALE_REVIEW', 'The approved review no longer matches this resource draft');
      const published = studioRecord({
        ...row,
        document: requested,
        status: 'published',
        published_at: row.published_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return published ?? data;
    },

    async listPage(filter: ResourceListFilter, context: ResourceContext): Promise<ResourcePage> {
      const parsed = ResourceListFilterSchema.parse(filter);
      const page = parsed.page ?? 1;
      let query = database.from('resources')
        .select('id,document,published_at', { count: 'exact' })
        .eq('status', 'published');
      query = excludeInternalContent(withBranchScope(query, context.branchId));
      if (parsed.type) query = query.eq('document->>resourceType', parsed.type);
      if (parsed.tag) query = query.contains('document', { tags: [parsed.tag] });
      if (parsed.pathway) query = query.contains('document', { pathways: [parsed.pathway] });
      if (parsed.search) query = query.textSearch('search', parsed.search, { config: 'simple', type: 'websearch' });
      const result = await query.order('published_at', { ascending: false }).order('id', { ascending: true })
        .range((page - 1) * 50, page * 50 - 1);
      if (result.error) databaseError('Resources could not be listed');
      const items = Array.isArray(result.data) ? result.data.flatMap((value) => {
        const resource = localizedResource(value, context.locale);
        return resource ? [resource] : [];
      }) : [];
      return { items, total: typeof result.count === 'number' ? result.count : items.length, page, pageSize: 50 };
    },

    async list(filter: ResourceListFilter, context: ResourceContext) {
      return (await this.listPage(filter, context)).items;
    },

    async get(id: string, context: ResourceContext) {
      let query = database.from('resources')
        .select('id,document,published_at,status')
        .eq('id', id)
        .eq('status', 'published');
      query = withBranchScope(query, context.branchId);
      const { data, error } = await query.maybeSingle();
      if (error) databaseError('Resource could not be loaded');
      const resource = localizedResource(data, context.locale);
      if (!resource) notFound(id);
      return resource;
    },

    async listStudio(page = 1) {
      await requirePermission('resource.edit');
      const parsedPage = z.number().int().min(1).max(10_000).parse(page);
      let query = database.from('resources')
        .select('id,document,status,owner_id,published_at,updated_at')
      if (scope?.kind === 'branch') query = query.eq('ownership_kind', 'branch').eq('owner_branch_id', scope.branchId);
      const { data, error } = await query.order('updated_at', { ascending: false }).range((parsedPage - 1) * 50, parsedPage * 50 - 1);
      if (error) databaseError('Resource drafts could not be listed');
      return Array.isArray(data) ? data : [];
    },

    async getStudio(id: string) {
      const actor = await requirePermission('resource.edit');
      const { data, error } = await database.from('resources')
        .select('id,document,status,owner_id,published_at,updated_at')
        .eq('id', id)
        .maybeSingle();
      if (error) databaseError('Resource could not be loaded');
      const liveRow = record(data);
      if (liveRow?.status === 'published') {
        const candidateResult = await database.rpc('cms_get_editor_content', {
          p_actor_user_id: actor.userId,
          p_content_type: 'resource',
          p_content_id: id,
        });
        if (candidateResult.error) databaseError('Resource draft could not be loaded');
        const candidate = record(candidateResult.data);
        const draftDocument = record(candidate?.source)?.document;
        if (candidate?.has_draft === true && typeof candidate.revision_key === 'string') {
          const pending = studioRecord({ ...liveRow, document: draftDocument, status: 'draft', updated_at: candidate.revision_key });
          if (pending) return pending;
        }
      }
      const resource = studioRecord(liveRow);
      if (!resource) notFound(id);
      return resource;
    },
  };
}
