import 'server-only';
import { getLocale } from 'next-intl/server';
import { actorDisplayNames } from '@/features/admin/actor-directory';
import type { ContentRow, ReviewRow } from '@/features/admin/components/ContentReviewWorkspace';
import { createContentReviewService, type ContentReviewDatabase } from '@/features/admin/content-review';
import { contentEditorHref } from '@/features/content-review/lifecycle';
import { studioPageContext } from '@/features/workspace/context';
import { can, type Permission } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { supabaseService } from '@/lib/supabase/server';
import { workspaceNavigationFor } from '@/lib/workspace-navigation';
import { CONTENT_STAGES, localizedTitle, rowStage, type ContentStage } from './ui/home/stages';

/**
 * Every read behind the PR 6 Studio pages (/studio, /studio/library, /studio/reviews) goes through
 * this module, so page tests mock one place and the views receive plain serializable data.
 */

export type StudioShortcutKey = 'courses' | 'library' | 'questionBank' | 'reviews';
export type StudioHomeShortcut = { key: StudioShortcutKey; href: string };
export type StudioOwner = { kind: 'central' } | { kind: 'branch'; name: string };

export type StudioHomeReviewRow = {
  id: string;
  title: string;
  contentType: string;
  owner: StudioOwner;
  status: string;
  submittedAt: string | null;
  submitter: string | null;
};

export type StudioHomeContentRow = {
  key: string;
  title: string;
  contentType: string;
  href: string;
  status: string;
  stage: ContentStage | null;
  updatedAt: string | null;
};

export type StudioHomeActivity = {
  id: string;
  kind: 'updated' | 'submitted';
  /** Content updates name the managing owner (the list carries no editor id); submissions name the person. */
  actor: { kind: 'owner'; owner: StudioOwner } | { kind: 'person'; name: string | null; avatarUrl: string | null };
  target: string;
  href: string | null;
  at: string | null;
};

/** hidden = no permission (the card is not rendered); unavailable = the read failed (never shown as 0). */
export type StudioSection<T> = { state: 'hidden' } | { state: 'unavailable' } | ({ state: 'ready' } & T);

export type StudioTypeBreakdown = { contentType: string; counts: Record<ContentStage, number> };

export type StudioHomeData = {
  /** ISO time the snapshot was read; the activity feed measures relative times from it. */
  generatedAt: string;
  shortcuts: StudioHomeShortcut[];
  primary: StudioHomeShortcut | null;
  /** Library base URL when the actor may open it; KPI and stage links add `?status=`. */
  libraryHref: string | null;
  reviewsHref: string | null;
  /** Reviewers anchor the page on the waiting queue; everyone else on recent content. */
  reviewer: boolean;
  reviews: StudioSection<{ pending: number; waiting: StudioHomeReviewRow[] }>;
  content: StudioSection<{ total: number; stages: Record<ContentStage, number>; byType: StudioTypeBreakdown[]; recent: StudioHomeContentRow[] }>;
  activity: StudioSection<{ items: StudioHomeActivity[] }>;
};

const CONTENT_READ: Permission[] = ['content.read', 'course.read', 'resource.edit', 'opportunity.edit', 'project.edit', 'media.upload'];
const REVIEW_READ: Permission[] = ['content.review', 'content.publish'];
/** Display order for content types; unknown types follow in the order they appear. */
const TYPE_ORDER = ['course', 'resource', 'opportunity', 'project', 'bank_question', 'media_asset'];
const RECENT_LIMIT = 5;
const WAITING_LIMIT = 5;
const ACTIVITY_LIMIT = 6;

type Branches = ReadonlyArray<{ id: string; name: string }>;
type Record_ = Record<string, unknown>;

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
const record = (value: unknown): Record_ | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record_) : null);

function owner(ownershipKind: unknown, branchId: unknown, branches: Branches): StudioOwner {
  const id = text(branchId);
  if (ownershipKind === 'central' || !id) return { kind: 'central' };
  return { kind: 'branch', name: branches.find((branch) => branch.id === id)?.name ?? id };
}

function zeroStages(): Record<ContentStage, number> {
  return Object.fromEntries(CONTENT_STAGES.map((stage) => [stage, 0])) as Record<ContentStage, number>;
}

function time(value: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function contentKey(type: unknown, id: unknown) {
  return `${String(type)}:${String(id)}`;
}

/** A /studio/ link from the CMS row, else the library (never an arbitrary URL from data). */
function studioHref(value: unknown, contentType?: unknown, contentId?: unknown) {
  // A non-Studio link (another school's read-only content) never becomes an href or an editor link.
  if (typeof value !== 'string' || !value.startsWith('/studio/')) return routes.studio.library();
  return contentEditorHref(contentType, contentId, value);
}

export async function studioHomeData(): Promise<StudioHomeData> {
  const [context, locale] = await Promise.all([studioPageContext(), getLocale()]);
  const permissions = context.permissions;
  const branches: Branches = context.branches ?? [];
  const navigation = workspaceNavigationFor('studio', permissions).filter((item) => item.key !== 'home' && item.key !== 'mcp');
  const shortcuts = navigation.map((item) => ({ key: item.key as StudioShortcutKey, href: item.href }));
  const shortcut = (key: StudioShortcutKey) => shortcuts.find((item) => item.key === key) ?? null;
  const canReadReviews = REVIEW_READ.some((permission) => permissions.includes(permission));
  const canReadContent = CONTENT_READ.some((permission) => permissions.includes(permission));

  let service: ReturnType<typeof createContentReviewService> | null = null;
  const reviewService = () =>
    (service ??= createContentReviewService({ database: supabaseService() as unknown as ContentReviewDatabase, actor: context.actor, scope: context.scope }));

  const [reviewRows, contentRows] = await Promise.all([
    canReadReviews ? reviewService().listReviews().then((rows) => (Array.isArray(rows) ? rows.map(record).filter((row): row is Record_ => row !== null) : null), () => null) : Promise.resolve(undefined),
    canReadContent ? reviewService().listContent().then((rows) => (Array.isArray(rows) ? rows.map(record).filter((row): row is Record_ => row !== null) : null), () => null) : Promise.resolve(undefined),
  ]);

  const titles = new Map<string, string>();
  for (const row of contentRows ?? []) {
    const id = text(row.content_id);
    if (id) titles.set(contentKey(row.content_type, id), localizedTitle(row.title, locale) || id);
  }

  const pendingRows = (reviewRows ?? []).filter((row) => row.status === 'pending');
  const submitterIds = pendingRows.map((row) => text(row.submitted_by)).concat((reviewRows ?? []).slice(0, ACTIVITY_LIMIT).map((row) => text(row.submitted_by)));
  const people = submitterIds.some(Boolean) ? await actorDisplayNames(submitterIds) : new Map();
  const person = (id: unknown) => {
    const key = text(id)?.toLowerCase();
    return key ? (people.get(key) ?? null) : null;
  };

  const reviews: StudioHomeData['reviews'] =
    reviewRows === undefined
      ? { state: 'hidden' }
      : reviewRows === null
        ? { state: 'unavailable' }
        : {
            state: 'ready',
            pending: pendingRows.length,
            waiting: [...pendingRows]
              .sort((left, right) => time(text(left.submitted_at)) - time(text(right.submitted_at)))
              .slice(0, WAITING_LIMIT)
              .map((row, index) => {
                const contentId = text(row.content_id);
                return {
                  id: text(row.id) ?? `review-${index}`,
                  title: (contentId && titles.get(contentKey(row.content_type, contentId))) || contentId || '—',
                  contentType: String(row.content_type ?? ''),
                  owner: owner(row.ownership_kind ?? (row.owner_branch_id ? 'branch' : 'central'), row.owner_branch_id, branches),
                  status: String(row.status),
                  submittedAt: text(row.submitted_at),
                  submitter: person(row.submitted_by)?.name ?? null,
                };
              }),
          };

  let content: StudioHomeData['content'];
  if (contentRows === undefined) content = { state: 'hidden' };
  else if (contentRows === null) content = { state: 'unavailable' };
  else {
    const stages = zeroStages();
    const byTypeMap = new Map<string, Record<ContentStage, number>>();
    let total = 0;
    for (const row of contentRows) {
      const stage = rowStage({ status: String(row.status ?? ''), review_status: text(row.review_status) });
      if (!stage) continue;
      total += 1;
      stages[stage] += 1;
      const type = String(row.content_type ?? '');
      const counts = byTypeMap.get(type) ?? zeroStages();
      counts[stage] += 1;
      byTypeMap.set(type, counts);
    }
    const order = (type: string) => {
      const index = TYPE_ORDER.indexOf(type);
      return index === -1 ? TYPE_ORDER.length : index;
    };
    const byType = [...byTypeMap.entries()].sort(([left], [right]) => order(left) - order(right)).map(([contentType, counts]) => ({ contentType, counts }));
    const recent = contentRows
      .filter((row) => text(row.content_id))
      .map((row) => ({ row, at: text(row.updated_at) }))
      .sort((left, right) => time(right.at) - time(left.at))
      .slice(0, RECENT_LIMIT)
      .map(({ row, at }) => ({
        key: contentKey(row.content_type, row.content_id),
        title: titles.get(contentKey(row.content_type, row.content_id)) ?? String(row.content_id),
        contentType: String(row.content_type ?? ''),
        href: studioHref(row.studio_href, row.content_type, row.content_id),
        status: String(row.status ?? ''),
        stage: rowStage({ status: String(row.status ?? ''), review_status: text(row.review_status) }),
        updatedAt: at,
      }));
    content = { state: 'ready', total, stages, byType, recent };
  }

  let activity: StudioHomeData['activity'];
  if (contentRows === undefined && reviewRows === undefined) activity = { state: 'hidden' };
  else if ((contentRows ?? null) === null && (reviewRows ?? null) === null) activity = { state: 'unavailable' };
  else {
    const updates: StudioHomeActivity[] = (contentRows ?? [])
      .filter((row) => text(row.content_id))
      .map((row) => ({
        id: `updated:${contentKey(row.content_type, row.content_id)}`,
        kind: 'updated' as const,
        actor: { kind: 'owner' as const, owner: owner(row.ownership_kind, row.owner_branch_id, branches) },
        target: titles.get(contentKey(row.content_type, row.content_id)) ?? String(row.content_id),
        href: studioHref(row.studio_href, row.content_type, row.content_id),
        at: text(row.updated_at),
      }));
    const submissions: StudioHomeActivity[] = (reviewRows ?? [])
      .filter((row) => text(row.content_id) && text(row.submitted_at))
      .map((row, index) => {
        const found = person(row.submitted_by);
        const contentId = text(row.content_id)!;
        return {
          id: `submitted:${text(row.id) ?? index}`,
          kind: 'submitted' as const,
          actor: { kind: 'person' as const, name: found?.name ?? null, avatarUrl: found?.avatarUrl ?? null },
          target: titles.get(contentKey(row.content_type, contentId)) ?? contentId,
          href: shortcut('reviews')?.href ?? null,
          at: text(row.submitted_at),
        };
      });
    const items = [...updates, ...submissions].sort((left, right) => time(right.at) - time(left.at)).slice(0, ACTIVITY_LIMIT);
    activity = { state: 'ready', items };
  }

  const reviewer = permissions.includes('content.review') && reviews.state !== 'hidden';
  const primary = (reviewer ? shortcut('reviews') : null) ?? shortcut('library') ?? shortcut('courses');
  return {
    generatedAt: new Date().toISOString(),
    shortcuts,
    primary,
    libraryHref: shortcut('library')?.href ?? null,
    reviewsHref: shortcut('reviews')?.href ?? null,
    reviewer,
    reviews,
    content,
    activity,
  };
}

// ---------------------------------------------------------------- /studio/library

const EDITING: Record<string, Permission> = {
  course: 'course.edit',
  resource: 'resource.edit',
  opportunity: 'opportunity.edit',
  project: 'project.edit',
  bank_question: 'bank.edit',
  media_asset: 'media.upload',
};

export type StudioLibraryData = {
  rows: ContentRow[];
  scope: Awaited<ReturnType<typeof studioPageContext>>['scope'];
  actorId: string;
  branches: { id: string; name: string }[];
  creatableTypes: string[];
  requestableKeys: string[];
};

export async function studioLibraryData(): Promise<StudioLibraryData> {
  const context = await studioPageContext();
  const service = createContentReviewService({ database: supabaseService() as unknown as ContentReviewDatabase, actor: context.actor, scope: context.scope });
  const rows = (await service.listContent()) as ContentRow[];
  const creatableTypes = Object.entries(EDITING)
    .filter(([kind, permission]) => can(context.actor, 'content.create', context.scope) || can(context.actor, kind === 'course' ? 'course.create' : permission, context.scope))
    .map(([kind]) => kind);
  const requestableKeys = rows
    .filter((row) => {
      const scope = row.ownership_kind === 'central' ? { kind: 'central' as const } : { kind: 'branch' as const, branchId: row.owner_branch_id! };
      return can(context.actor, 'content.review.request', scope) || can(context.actor, EDITING[row.content_type], scope);
    })
    .map((row) => `${row.content_type}:${row.content_id}`);
  return {
    rows,
    scope: context.scope,
    actorId: context.actor.userId,
    branches: context.branches.map((branch) => ({ id: branch.id, name: branch.name })),
    creatableTypes,
    requestableKeys,
  };
}

// ---------------------------------------------------------------- /studio/reviews

export type StudioReviewsData = {
  rows: ReviewRow[];
  scope: StudioLibraryData['scope'];
  actorId: string;
  branches: { id: string; name: string }[];
  canReview: boolean;
  canPublish: boolean;
  publishableTypes: string[];
  /** Content titles as stored ({vi,en} or string) keyed `type:id`; missing keys fall back to the id. */
  titles: Record<string, unknown>;
  /** Submitter display names keyed by lower-cased user id. */
  submitters: Record<string, string>;
};

export async function studioReviewsData(): Promise<StudioReviewsData> {
  const context = await studioPageContext();
  const service = createContentReviewService({ database: supabaseService() as unknown as ContentReviewDatabase, actor: context.actor, scope: context.scope });
  const [rows, contentRows] = await Promise.all([
    service.listReviews() as Promise<ReviewRow[]>,
    // Titles are a convenience: a failed or forbidden content read leaves the ids in place.
    service.listContent().then((value) => (Array.isArray(value) ? value : []), () => []),
  ]);
  const titles: Record<string, unknown> = {};
  for (const value of contentRows) {
    const row = record(value);
    if (row && text(row.content_id) && row.title !== undefined && row.title !== null) titles[contentKey(row.content_type, row.content_id)] = row.title;
  }
  const people = await actorDisplayNames(rows.map((row) => row.submitted_by ?? null));
  const submitters = Object.fromEntries([...people.entries()].map(([id, actor]) => [id, actor.name]));
  const central = { kind: 'central' } as const;
  const publishableTypes = [
    ...([['course', 'course.publish'], ['bank_question', 'bank.publish'], ['resource', 'resource.publish'], ['opportunity', 'opportunity.publish']] as const)
      .filter(([, permission]) => can(context.actor, permission, central))
      .map(([type]) => type),
    'project',
    'media_asset',
  ];
  return {
    rows,
    scope: context.scope,
    actorId: context.actor.userId,
    branches: context.branches.map((branch) => ({ id: branch.id, name: branch.name })),
    canReview: context.scope.kind === 'central' && can(context.actor, 'content.review', central),
    canPublish: context.scope.kind === 'central' && can(context.actor, 'content.publish', central),
    publishableTypes,
    titles,
    submitters,
  };
}
