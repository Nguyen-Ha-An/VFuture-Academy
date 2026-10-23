import 'server-only';

import { z } from 'zod';

import { IdSchema, l10n, type L10nString } from '@/content-engine/schema/common';
import { ApiError } from '@/lib/api';
import { audit } from '@/lib/audit';
import { internalContentPolicy, isInternalContentId } from '@/lib/internal-content';
import { isoRevisionTimestamp } from '@/features/content-review/revision';
import { can, hasPermission, type Actor, type Scope } from '@/lib/permissions';
import { RESERVED_PROJECT_IDS } from '@/features/projects/ids';
import { actorScopes } from '@/lib/workspace-admission';

export const PROJECT_STATUSES = ['idea', 'forming', 'active', 'completed', 'showcased'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const ProjectTextSchema = l10n(z.string().trim().min(1).max(2_000));
const ProjectLabelSchema = l10n(z.string().trim().min(1).max(200));
const ProjectMemberRoleSchema = z.enum(['owner', 'member', 'mentor']);
export const ProjectBranchScopeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global') }).strict(),
  z.object({ scope: z.literal('branches'), branchIds: z.array(IdSchema).min(1).max(100) }).strict(),
]);
const ProjectMemberInputSchema = z.object({
  userId: z.uuid(),
  role: ProjectMemberRoleSchema,
}).strict();

export const ProjectOutputLinkSchema = z.object({
  label: ProjectLabelSchema,
  url: z.url().refine((url) => url.startsWith('https://'), { message: 'url must use https' }),
}).strict();

const ProjectFieldsSchema = z.object({
  id: IdSchema,
  title: ProjectTextSchema,
  summary: ProjectTextSchema,
  outputLinks: z.array(ProjectOutputLinkSchema).max(20).default([]),
  skills: z.array(IdSchema).max(50).default([]),
  courseIds: z.array(IdSchema).max(50).default([]),
  coverAssetId: z.string().regex(/^asset_[A-Za-z0-9_-]{1,80}$/).nullable().default(null),
}).strict();

function uniqueMembers(members: readonly { userId: string }[]): boolean {
  return new Set(members.map(({ userId }) => userId)).size === members.length;
}

export const ProjectInputSchema = ProjectFieldsSchema.extend({
  status: z.enum(PROJECT_STATUSES),
  approved: z.boolean().default(false),
  branchScope: ProjectBranchScopeSchema.default({ scope: 'global' }),
  members: z.array(ProjectMemberInputSchema).max(100).default([]),
  expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => {
  if (!uniqueMembers(value.members)) {
    ctx.addIssue({ code: 'custom', path: ['members'], message: 'Project members must be unique' });
  }
  if (value.members.filter(({ role }) => role === 'owner').length > 1) {
    ctx.addIssue({ code: 'custom', path: ['members'], message: 'A project can have only one owner' });
  }
});

export const ProjectProposalSchema = ProjectFieldsSchema.extend({
  members: z.array(ProjectMemberInputSchema.extend({
    role: z.enum(['member', 'mentor']),
  }).strict()).max(99).default([]),
}).strict().superRefine((value, ctx) => {
  if (!uniqueMembers(value.members)) {
    ctx.addIssue({ code: 'custom', path: ['members'], message: 'Project members must be unique' });
  }
});

export const ProjectInterestSchema = z.object({ interested: z.boolean() }).strict();

export type ProjectOutputLink = z.infer<typeof ProjectOutputLinkSchema>;
export type ProjectMemberRole = z.infer<typeof ProjectMemberRoleSchema>;
export type ProjectInput = z.infer<typeof ProjectInputSchema>;
export type ProjectProposal = z.infer<typeof ProjectProposalSchema>;
export type ProjectBranchScope = z.infer<typeof ProjectBranchScopeSchema>;

export type ProjectRecord = {
  id: string;
  title: L10nString;
  summary: L10nString;
  status: ProjectStatus;
  outputLinks: ProjectOutputLink[];
  skills: string[];
  courseIds: string[];
  ownerId: string;
  coverAssetId: string | null;
  approved: boolean;
  branchScope: ProjectBranchScope;
  createdAt: string;
  updatedAt: string;
  ownershipKind?: 'central' | 'branch';
  ownerBranchId?: string | null;
};

export type ProjectRelationship = 'showcase' | 'proposal' | 'participation';

export type ProjectListEntry = ProjectRecord & {
  viewerRole: ProjectMemberRole | null;
  relationship: ProjectRelationship;
};

export type ProjectMember = {
  userId: string;
  role: ProjectMemberRole;
  displayName: string | null;
  handle: string | null;
};

export type ProjectInterestPerson = Omit<ProjectMember, 'role'>;

export type ProjectCourse = {
  id: string;
  title: L10nString;
};

export type ProjectMediaAsset = {
  id: string;
  ownerId: string;
  mime: string;
  /** Learner uploads (`project_cover`) are never reusable by other accounts. */
  purpose?: 'content' | 'project_cover';
};

export type ProjectDetail = ProjectRecord & {
  members: ProjectMember[];
  relatedCourses: ProjectCourse[];
  interested: boolean;
  viewerRole: ProjectMemberRole | null;
  canExpressInterest: boolean;
  interestList?: ProjectInterestPerson[];
};

export type ProjectFilters = {
  statuses?: ProjectStatus[];
  skills?: string[];
  courseIds?: string[];
};

export interface ProjectStore {
  listProjects(): Promise<ProjectRecord[]>;
  findProjectsByCover(assetId: string): Promise<ProjectRecord[]>;
  findProject(id: string): Promise<ProjectRecord | null>;
  findReviewDraft(actorId: string, id: string): Promise<ProjectRecord | null>;
  findMediaAsset(id: string): Promise<ProjectMediaAsset | null>;
  createProject(project: ProjectRecord, members: ProjectMember[]): Promise<ProjectRecord>;
  createProposal(project: ProjectRecord, members: ProjectMember[], since: string, limit: number): Promise<ProjectRecord>;
  updateProject(actorId: string, project: ProjectRecord, members: ProjectMember[], expectedRevision: string): Promise<ProjectRecord | null>;
  saveReviewDraft(actorId: string, project: ProjectRecord, members: ProjectMember[], expectedRevision: string): Promise<ProjectRecord>;
  deleteProject(actorId: string, id: string, expectedRevision: string): Promise<boolean>;
  findViewerBranch(userId: string): Promise<string | null>;
  listViewerMemberships(userId: string): Promise<Array<{ projectId: string; role: ProjectMemberRole }>>;
  listMembers(projectId: string): Promise<ProjectMember[]>;
  listCourses(courseIds: string[], viewerBranchId?: string | null): Promise<ProjectCourse[]>;
  hasInterest(projectId: string, userId: string): Promise<boolean>;
  setInterest(projectId: string, userId: string, interested: boolean): Promise<void>;
  listInterests(projectId: string): Promise<ProjectInterestPerson[]>;
  trackView(projectId: string, userId: string): Promise<void>;
}

type ProjectPermissionCheck = (permission: 'project.edit') => Promise<Actor>;

function databaseError(message: string): never {
  throw new ApiError(500, 'PROJECT_DATABASE_ERROR', message);
}

function notFound(): never {
  throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project was not found');
}

/** New projects cannot take ids that collide with learner route segments. */
function requireUnreservedId(id: string): void {
  if (RESERVED_PROJECT_IDS.has(id)) {
    throw new ApiError(400, 'PROJECT_ID_RESERVED', 'This project id is reserved; choose another link');
  }
}

function projectScope(project: ProjectRecord): Scope {
  return project.ownershipKind === 'branch' && project.ownerBranchId
    ? { kind: 'branch', branchId: project.ownerBranchId }
    : { kind: 'central' };
}

function memberViews(
  members: readonly { userId: string; role: ProjectMemberRole }[],
): ProjectMember[] {
  return members.map((member) => ({ ...member, displayName: null, handle: null }));
}

function normalizedMembers(
  members: readonly { userId: string; role: ProjectMemberRole }[],
  fallbackOwnerId: string,
): { ownerId: string; members: ProjectMember[] } {
  const explicitOwner = members.find(({ role }) => role === 'owner');
  const ownerId = explicitOwner?.userId ?? fallbackOwnerId;
  const withoutFallback = members.filter(({ userId }) => userId !== ownerId);
  return {
    ownerId,
    members: memberViews([{ userId: ownerId, role: 'owner' }, ...withoutFallback]),
  };
}

function overlaps(left: readonly string[], right: readonly string[] | undefined): boolean {
  return !right?.length || right.some((value) => left.includes(value));
}

function matchesFilters(project: ProjectRecord, filters: ProjectFilters): boolean {
  return (!filters.statuses?.length || filters.statuses.includes(project.status))
    && overlaps(project.skills, filters.skills)
    && overlaps(project.courseIds, filters.courseIds);
}

export function projectScopeAllows(scope: ProjectBranchScope, viewerBranchId: string | null): boolean {
  return scope.scope === 'global'
    || (viewerBranchId !== null && scope.branchIds.includes(viewerBranchId));
}

function visibleTo(
  project: ProjectRecord,
  viewerRole: ProjectMemberRole | null,
  viewerBranchId: string | null,
): boolean {
  return (project.approved || viewerRole !== null)
    && projectScopeAllows(project.branchScope, viewerBranchId);
}

function relationshipOf(project: ProjectRecord, viewerRole: ProjectMemberRole | null): ProjectRelationship {
  if (!project.approved && viewerRole === 'owner') return 'proposal';
  if (viewerRole !== null) return 'participation';
  return 'showcase';
}

function utcDayStart(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

function auditState(project: ProjectRecord) {
  return {
    status: project.status,
    approved: project.approved,
    ownerId: project.ownerId,
    coverAssetId: project.coverAssetId,
  };
}

export function actorPermissionCheck(actor: Actor, scope?: Scope): ProjectPermissionCheck {
  return async () => {
    if (!hasPermission(actor, 'content.edit', scope) && !hasPermission(actor, 'project.edit', scope)) {
      throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
    }
    return actor;
  };
}

export function createProjectService({
  store,
  authorize,
  scope,
  now = () => new Date(),
}: {
  store: ProjectStore;
  authorize: ProjectPermissionCheck;
  scope?: Scope;
  now?: () => Date;
}) {
  async function requireCoverAsset(
    callerId: string,
    assetId: string | null,
    canUseForeignAsset: boolean,
  ): Promise<void> {
    if (!assetId) return;
    const asset = await store.findMediaAsset(assetId);
    if (!asset
      || !asset.mime.toLowerCase().startsWith('image/')
      || (asset.ownerId !== callerId && (!canUseForeignAsset || asset.purpose === 'project_cover'))) {
      throw new ApiError(403, 'PROJECT_COVER_FORBIDDEN', 'Project cover asset is not permitted');
    }
  }

  async function detail(
    project: ProjectRecord,
    viewerId: string,
    track: boolean,
    viewerBranchId?: string | null,
    viewerRole: ProjectMemberRole | null = null,
    includeInterestList = false,
  ): Promise<ProjectDetail> {
    const [members, relatedCourses, interested] = await Promise.all([
      store.listMembers(project.id),
      store.listCourses(project.courseIds, viewerBranchId),
      store.hasInterest(project.id, viewerId),
      track ? store.trackView(project.id, viewerId) : Promise.resolve(),
    ]);
    const base = {
      ...project,
      members,
      relatedCourses,
      interested,
      viewerRole,
      canExpressInterest: project.approved,
    };
    if (!includeInterestList && viewerRole !== 'owner') return base;
    return { ...base, interestList: await store.listInterests(project.id) };
  }

  return {
    async list(viewerId: string, filters: ProjectFilters): Promise<ProjectListEntry[]> {
      const [projects, viewerBranchId, memberships] = await Promise.all([
        store.listProjects(),
        store.findViewerBranch(viewerId),
        store.listViewerMemberships(viewerId),
      ]);
      const membershipByProject = new Map(memberships.map(({ projectId, role }) => [projectId, role]));
      const internal = internalContentPolicy();
      return projects.flatMap((project) => {
        const viewerRole = project.ownerId === viewerId ? 'owner' : membershipByProject.get(project.id) ?? null;
        // Hidden fixtures stay listed for their own members, mirroring enrolled catalog rows.
        if (viewerRole === null && isInternalContentId(project.id, internal)) return [];
        return visibleTo(project, viewerRole, viewerBranchId) && matchesFilters(project, filters)
          ? [{ ...project, viewerRole, relationship: relationshipOf(project, viewerRole) }]
          : [];
      });
    },

    async get(viewerId: string, id: string): Promise<ProjectDetail> {
      const projectId = IdSchema.parse(id);
      const [project, viewerBranchId, memberships] = await Promise.all([
        store.findProject(projectId),
        store.findViewerBranch(viewerId),
        store.listViewerMemberships(viewerId),
      ]);
      const viewerRole = project?.ownerId === viewerId
        ? 'owner'
        : memberships.find((membership) => membership.projectId === projectId)?.role ?? null;
      if (!project || !visibleTo(project, viewerRole, viewerBranchId)) notFound();
      return detail(project, viewerId, true, viewerBranchId, viewerRole);
    },

    async propose(ownerId: string, input: unknown): Promise<ProjectRecord> {
      const parsed = ProjectProposalSchema.parse(input);
      requireUnreservedId(parsed.id);
      if (parsed.members.some(({ userId }) => userId !== ownerId)) {
        throw new ApiError(403, 'PROJECT_MEMBERSHIP_FORBIDDEN', 'Learner proposals cannot add other members');
      }
      const [existing, branchId] = await Promise.all([
        store.findProject(parsed.id),
        store.findViewerBranch(ownerId),
      ]);
      if (existing) {
        throw new ApiError(409, 'PROJECT_EXISTS', 'A project with this id already exists');
      }
      await requireCoverAsset(ownerId, parsed.coverAssetId, false);
      const clock = now();
      const timestamp = clock.toISOString();
      const members = memberViews([
        { userId: ownerId, role: 'owner' },
        ...parsed.members.filter(({ userId }) => userId !== ownerId),
      ]);
      return store.createProposal({
        id: parsed.id,
        title: parsed.title,
        summary: parsed.summary,
        status: 'idea',
        outputLinks: parsed.outputLinks,
        skills: [...new Set(parsed.skills)],
        courseIds: [...new Set(parsed.courseIds)],
        ownerId,
        coverAssetId: parsed.coverAssetId,
        approved: false,
        branchScope: branchId ? { scope: 'branches', branchIds: [branchId] } : { scope: 'global' },
        createdAt: timestamp,
        updatedAt: timestamp,
      }, members, utcDayStart(clock), 5);
    },

    async setInterest(viewerId: string, id: string, interested: boolean): Promise<{ interested: boolean }> {
      const projectId = IdSchema.parse(id);
      const [project, viewerBranchId, memberships] = await Promise.all([
        store.findProject(projectId),
        store.findViewerBranch(viewerId),
        store.listViewerMemberships(viewerId),
      ]);
      const viewerRole = project?.ownerId === viewerId
        ? 'owner'
        : memberships.find((membership) => membership.projectId === projectId)?.role ?? null;
      if (!project || !visibleTo(project, viewerRole, viewerBranchId)) notFound();
      if (!project.approved && interested) notFound();
      await store.setInterest(projectId, viewerId, interested);
      return { interested };
    },

    async canViewCover(viewerId: string, assetId: string): Promise<boolean> {
      const [projects, viewerBranchId, memberships] = await Promise.all([
        store.findProjectsByCover(assetId),
        store.findViewerBranch(viewerId),
        store.listViewerMemberships(viewerId),
      ]);
      const membershipByProject = new Map(memberships.map(({ projectId, role }) => [projectId, role]));
      return projects.some((project) => {
        const viewerRole = project.ownerId === viewerId ? 'owner' : membershipByProject.get(project.id) ?? null;
        return visibleTo(project, viewerRole, viewerBranchId);
      });
    },

    /** Lets reviewers and project editors see covers of projects in their scope. */
    async canReviewCover(actor: Actor, assetId: string): Promise<boolean> {
      // Most media reads come from learners; skip the cover lookup unless the
      // actor could review or edit a project in some scope.
      const mayReview = actorScopes(actor).some((candidate) =>
        can(actor, 'content.review', candidate) || can(actor, 'project.edit', candidate));
      if (!mayReview) return false;
      const projects = await store.findProjectsByCover(assetId);
      return projects.some((project) => {
        const ownerScope = projectScope(project);
        return can(actor, 'content.review', ownerScope) || can(actor, 'project.edit', ownerScope);
      });
    },

    async listStudio(filters: ProjectFilters): Promise<ProjectRecord[]> {
      await authorize('project.edit');
      return (await store.listProjects()).filter((project) =>
        matchesFilters(project, filters)
        && (scope?.kind !== 'branch' || (project.ownershipKind === 'branch' && project.ownerBranchId === scope.branchId)));
    },

    async getStudio(id: string): Promise<ProjectDetail> {
      const actor = await authorize('project.edit');
      let project = await store.findProject(IdSchema.parse(id));
      if (!project) notFound();
      if (project.approved) project = await store.findReviewDraft(actor.userId, project.id) ?? project;
      const memberships = await store.listViewerMemberships(actor.userId);
      const viewerRole = project.ownerId === actor.userId
        ? 'owner'
        : memberships.find((membership) => membership.projectId === project.id)?.role ?? null;
      return detail(project, actor.userId, false, undefined, viewerRole, true);
    },

    async createStudio(input: unknown): Promise<ProjectRecord> {
      const actor = await authorize('project.edit');
      const parsed = ProjectInputSchema.parse(input);
      requireUnreservedId(parsed.id);
      if (await store.findProject(parsed.id)) {
        throw new ApiError(409, 'PROJECT_EXISTS', 'A project with this id already exists');
      }
      await requireCoverAsset(actor.userId, parsed.coverAssetId, hasPermission(actor, 'media.upload'));
      const normalized = normalizedMembers(parsed.members, actor.userId);
      const timestamp = now().toISOString();
      const { expectedUpdatedAt: _expectedUpdatedAt, ...projectFields } = parsed;
      return store.createProject({
        ...projectFields,
        approved: false,
        outputLinks: parsed.outputLinks,
        skills: [...new Set(parsed.skills)],
        courseIds: [...new Set(parsed.courseIds)],
        ownerId: normalized.ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }, normalized.members);
    },

    async updateStudio(id: string, input: unknown): Promise<ProjectRecord> {
      const actor = await authorize('project.edit');
      const projectId = IdSchema.parse(id);
      const parsed = ProjectInputSchema.parse(input);
      if (parsed.id !== projectId) {
        throw new ApiError(400, 'PROJECT_ID_MISMATCH', 'Project id does not match the route');
      }
      const live = await store.findProject(projectId);
      if (!live) notFound();
      const current = await store.findReviewDraft(actor.userId, projectId) ?? live;
      if (!parsed.expectedUpdatedAt) {
        throw new ApiError(428, 'PRECONDITION_REQUIRED', 'expectedUpdatedAt is required');
      }
      if (parsed.expectedUpdatedAt !== current.updatedAt) {
        throw new ApiError(409, 'PROJECT_DRAFT_CONFLICT', 'Project draft changed before this save completed');
      }
      if (parsed.approved !== live.approved) {
        throw new ApiError(409, 'PROJECT_REVIEW_REQUIRED', 'Project approval can change only through Central content review');
      }
      // A cover already stored on the project (for example a learner's proposal
      // cover) was checked when it was assigned, so reviewers without
      // media.upload can still save the project; new covers are checked again.
      if (parsed.coverAssetId !== live.coverAssetId && parsed.coverAssetId !== current.coverAssetId) {
        await requireCoverAsset(actor.userId, parsed.coverAssetId, hasPermission(actor, 'media.upload'));
      }
      const normalized = normalizedMembers(parsed.members, current.ownerId || actor.userId);
      const { expectedUpdatedAt, ...projectFields } = parsed;
      const candidate: ProjectRecord = {
        ...projectFields,
        outputLinks: parsed.outputLinks,
        skills: [...new Set(parsed.skills)],
        courseIds: [...new Set(parsed.courseIds)],
        approved: live.approved,
        ownerId: normalized.ownerId,
        createdAt: live.createdAt,
        updatedAt: now().toISOString(),
      };
      if (live.approved) {
        const draft = await store.saveReviewDraft(actor.userId, candidate, normalized.members, expectedUpdatedAt);
        await audit(actor, 'project.draft.update', { type: 'project', id: projectId }, auditState(current), auditState(draft));
        return draft;
      }
      const updated = await store.updateProject(actor.userId, candidate, normalized.members, expectedUpdatedAt);
      if (!updated) notFound();
      await audit(
        actor,
        'project.update',
        { type: 'project', id: projectId },
        auditState(current),
        auditState(updated),
      );
      return updated;
    },

    async deleteStudio(id: string, expectedUpdatedAt?: string): Promise<{ id: string; deleted: true }> {
      const actor = await authorize('project.edit');
      const projectId = IdSchema.parse(id);
      if (!expectedUpdatedAt) throw new ApiError(428, 'PRECONDITION_REQUIRED', 'If-Match is required');
      const live = await store.findProject(projectId);
      if (!live) notFound();
      if (live.approved) {
        throw new ApiError(409, 'PROJECT_PUBLISHED_DELETE_FORBIDDEN', 'Published projects cannot be deleted from Studio');
      }
      const current = await store.findReviewDraft(actor.userId, projectId) ?? live;
      if (current.updatedAt !== expectedUpdatedAt) {
        throw new ApiError(409, 'PROJECT_DRAFT_CONFLICT', 'Project changed before deletion completed');
      }
      if (!await store.deleteProject(actor.userId, projectId, expectedUpdatedAt)) notFound();
      await audit(
        actor,
        'project.delete',
        { type: 'project', id: projectId },
        auditState(current),
        null,
      );
      return { id: projectId, deleted: true };
    },
  };
}

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };

export interface ProjectQuery extends PromiseLike<QueryResult> {
  select(columns: string, options?: { count?: 'exact'; head?: boolean }): this;
  eq(column: string, value: unknown): this;
  gte(column: string, value: unknown): this;
  in(column: string, values: unknown[]): this;
  insert(value: unknown): this;
  update(value: unknown): this;
  delete(): this;
  upsert(value: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }): this;
  order(column: string, options?: { ascending?: boolean }): this;
  maybeSingle(): Promise<QueryResult>;
}

export interface ProjectDatabase {
  from(table: string): ProjectQuery;
  rpc(name: string, args?: Record<string, unknown>): Promise<QueryResult>;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const row = record(entry);
    return row ? [row] : [];
  }) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function localized(value: unknown): L10nString {
  if (typeof value === 'string') return value;
  const row = record(value);
  const result = {
    ...(typeof row?.vi === 'string' ? { vi: row.vi } : {}),
    ...(typeof row?.en === 'string' ? { en: row.en } : {}),
  };
  return Object.keys(result).length > 0 ? result : '';
}

function branchScopeOf(value: unknown): ProjectBranchScope | null {
  const parsed = ProjectBranchScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function projectOf(value: unknown): ProjectRecord | null {
  const row = record(value);
  if (!row || typeof row.id !== 'string' || typeof row.owner_id !== 'string') return null;
  if (!PROJECT_STATUSES.includes(row.status as ProjectStatus)) return null;
  const branchScope = branchScopeOf(row.branch_scope);
  if (!branchScope) return null;
  return {
    id: row.id,
    title: localized(row.title),
    summary: localized(row.summary),
    status: row.status as ProjectStatus,
    outputLinks: Array.isArray(row.output_links)
      ? row.output_links.flatMap((link) => {
        const parsed = ProjectOutputLinkSchema.safeParse(link);
        return parsed.success ? [parsed.data] : [];
      })
      : [],
    skills: stringArray(row.skills),
    courseIds: stringArray(row.course_ids),
    ownerId: row.owner_id,
    coverAssetId: typeof row.cover_asset_id === 'string' ? row.cover_asset_id : null,
    approved: row.approved === true,
    branchScope,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
    ...('ownership_kind' in row ? { ownershipKind: row.ownership_kind === 'branch' ? 'branch' as const : 'central' as const } : {}),
    ...('owner_branch_id' in row ? { ownerBranchId: typeof row.owner_branch_id === 'string' ? row.owner_branch_id : null } : {}),
  };
}

// Studio content media and learner-uploaded covers can both back a project cover.
const PROJECT_COVER_PURPOSES: string[] = ['content', 'project_cover'];

const PROJECT_COLUMNS = 'id,title,summary,status,output_links,skills,course_ids,owner_id,cover_asset_id,approved,branch_scope,created_at,updated_at,ownership_kind,owner_branch_id';

function projectRow(project: ProjectRecord) {
  return {
    id: project.id,
    title: project.title,
    summary: project.summary,
    status: project.status,
    output_links: project.outputLinks,
    skills: project.skills,
    course_ids: project.courseIds,
    owner_id: project.ownerId,
    cover_asset_id: project.coverAssetId,
    approved: project.approved,
    branch_scope: project.branchScope,
    published_at: project.approved ? project.updatedAt : null,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}

function requireProject(value: unknown, message: string): ProjectRecord {
  const project = projectOf(value);
  if (!project) databaseError(message);
  return project;
}

export function createSupabaseProjectStore(database: ProjectDatabase): ProjectStore {
  const rpcMembers = (members: ProjectMember[]) => members.map((member) => ({
    user_id: member.userId,
    role: member.role,
  }));

  return {
    async listProjects() {
      const { data, error } = await database.from('projects').select(PROJECT_COLUMNS).order('created_at', { ascending: false });
      if (error) databaseError('Projects could not be listed');
      return rows(data).flatMap((row) => {
        const project = projectOf(row);
        return project ? [project] : [];
      });
    },

    async findProject(id) {
      const { data, error } = await database.from('projects').select(PROJECT_COLUMNS).eq('id', id).maybeSingle();
      if (error) databaseError('Project could not be loaded');
      return projectOf(data);
    },

    async findReviewDraft(actorId, id) {
      const { data, error } = await database.rpc('cms_get_editor_content', {
        p_actor_user_id: actorId,
        p_content_type: 'project',
        p_content_id: id,
      });
      if (error) databaseError('Project draft could not be loaded');
      const candidate = record(data);
      if (candidate?.has_draft !== true) return null;
      const draft = projectOf(record(candidate.source)?.record);
      return draft && typeof candidate.revision_key === 'string'
        ? { ...draft, updatedAt: isoRevisionTimestamp(candidate.revision_key) }
        : draft;
    },

    async findMediaAsset(id) {
      const { data, error } = await database.from('media_assets').select('id,owner_id,mime,purpose').eq('id', id).eq('bucket', 'media').in('purpose', PROJECT_COVER_PURPOSES).maybeSingle();
      if (error) databaseError('Project cover asset could not be loaded');
      const asset = record(data);
      if (asset?.id !== id
        || (asset.purpose !== undefined
          && (typeof asset.purpose !== 'string' || !PROJECT_COVER_PURPOSES.includes(asset.purpose)))
        || typeof asset.owner_id !== 'string' || typeof asset.mime !== 'string') return null;
      return {
        id,
        ownerId: asset.owner_id,
        mime: asset.mime,
        purpose: asset.purpose === 'project_cover' ? 'project_cover' : 'content',
      };
    },

    async findProjectsByCover(assetId) {
      const { data, error } = await database.from('projects').select(PROJECT_COLUMNS).eq('cover_asset_id', assetId);
      if (error) databaseError('Project covers could not be loaded');
      return rows(data).flatMap((row) => {
        const project = projectOf(row);
        return project ? [project] : [];
      });
    },

    async createProject(project, members) {
      const { data, error } = await database.rpc('studio_project_save', {
        p_project: projectRow(project),
        p_members: rpcMembers(members),
        p_create: true,
      });
      if (error?.code === '23505') throw new ApiError(409, 'PROJECT_EXISTS', 'A project with this id already exists');
      if (error) databaseError('Project could not be created');
      return requireProject(data, 'Project could not be created');
    },

    async createProposal(project, members, since, limit) {
      const { data, error } = await database.rpc('learner_project_propose', {
        p_project: projectRow(project),
        p_members: rpcMembers(members),
        p_owner_id: project.ownerId,
        p_since: since,
        p_limit: limit,
      });
      if (error?.message?.includes('PROJECT_PROPOSAL_LIMIT')) {
        throw new ApiError(429, 'PROJECT_PROPOSAL_LIMIT', 'You can propose up to five projects per day');
      }
      if (error?.code === '23505') throw new ApiError(409, 'PROJECT_EXISTS', 'A project with this id already exists');
      if (error) databaseError('Project proposal could not be created');
      return requireProject(data, 'Project proposal could not be created');
    },

    async updateProject(actorId, project, members, expectedRevision) {
      const { data, error } = await database.rpc('studio_project_save_guarded', {
        p_actor_user_id: actorId,
        p_project: projectRow(project),
        p_members: rpcMembers(members),
        p_create: false,
        p_expected_revision: expectedRevision,
      });
      if (error?.message?.includes('PROJECT_NOT_FOUND')) notFound();
      if (error?.message?.includes('CMS_REVIEW_PENDING')) throw new ApiError(409, 'CMS_REVIEW_PENDING', 'Withdraw the pending review before editing');
      if (error?.message?.includes('CMS_REVISION_CHANGED') || error?.code === '40001') {
        throw new ApiError(409, 'PROJECT_DRAFT_CONFLICT', 'Project draft changed before this save completed');
      }
      if (error) databaseError('Project could not be updated');
      if (!data) return null;
      return requireProject(data, 'Project could not be updated');
    },

    async saveReviewDraft(actorId, project, members, expectedRevision) {
      const draftProject = { ...project, approved: false };
      const { data, error } = await database.rpc('cms_save_content_draft', {
        p_actor_user_id: actorId,
        p_content_type: 'project',
        p_content_id: project.id,
        p_expected_revision: expectedRevision,
        p_source: { record: projectRow(draftProject), members: rpcMembers(members) },
        p_audience: project.branchScope,
      });
      if (error?.message?.includes('CMS_REVIEW_PENDING')) throw new ApiError(409, 'CMS_REVIEW_PENDING', 'Withdraw the pending review before editing');
      if (error?.message?.includes('CMS_REVISION_CHANGED') || error?.code === '40001') {
        throw new ApiError(409, 'PROJECT_DRAFT_CONFLICT', 'Project draft changed before this save completed');
      }
      const saved = record(data);
      if (error || typeof saved?.revision_key !== 'string') databaseError('Project draft could not be saved');
      return { ...draftProject, updatedAt: isoRevisionTimestamp(saved.revision_key) };
    },

    async deleteProject(actorId, id, expectedRevision) {
      const { data, error } = await database.rpc('studio_project_delete_guarded', {
        p_actor_user_id: actorId,
        p_project_id: id,
        p_expected_revision: expectedRevision,
      });
      if (error?.message?.includes('PROJECT_PUBLISHED_DELETE_FORBIDDEN')) {
        throw new ApiError(409, 'PROJECT_PUBLISHED_DELETE_FORBIDDEN', 'Published projects cannot be deleted from Studio');
      }
      if (error?.message?.includes('CMS_REVIEW_PENDING')) throw new ApiError(409, 'CMS_REVIEW_PENDING', 'Withdraw the pending review before deleting');
      if (error?.message?.includes('CMS_REVISION_CHANGED') || error?.code === '40001') {
        throw new ApiError(409, 'PROJECT_DRAFT_CONFLICT', 'Project changed before deletion completed');
      }
      if (error) databaseError('Project could not be deleted');
      return data === true;
    },

    async findViewerBranch(userId) {
      const { data, error } = await database.from('profiles').select('branch_id').eq('id', userId).maybeSingle();
      if (error) databaseError('Viewer branch could not be loaded');
      const branchId = record(data)?.branch_id;
      return typeof branchId === 'string' ? branchId : null;
    },

    async listViewerMemberships(userId) {
      const { data, error } = await database.from('project_members')
        .select('project_id,role')
        .eq('user_id', userId);
      if (error) databaseError('Project memberships could not be loaded');
      return rows(data).flatMap((row) => {
        const role = ProjectMemberRoleSchema.safeParse(row.role);
        return typeof row.project_id === 'string' && role.success
          ? [{ projectId: row.project_id, role: role.data }]
          : [];
      });
    },

    async listMembers(projectId) {
      const memberResult = await database.from('project_members')
        .select('user_id,role')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (memberResult.error) databaseError('Project members could not be loaded');
      const memberships = rows(memberResult.data);
      const userIds = memberships.flatMap((row) => typeof row.user_id === 'string' ? [row.user_id] : []);
      if (userIds.length === 0) return [];
      const profileResult = await database.from('profiles').select('id,display_name,handle').in('id', userIds);
      if (profileResult.error) databaseError('Project member profiles could not be loaded');
      const profiles = new Map(rows(profileResult.data).flatMap((row) => typeof row.id === 'string' ? [[row.id, row] as const] : []));
      return memberships.flatMap((row): ProjectMember[] => {
        if (typeof row.user_id !== 'string' || !ProjectMemberRoleSchema.safeParse(row.role).success) return [];
        const profile = profiles.get(row.user_id);
        return [{
          userId: row.user_id,
          role: row.role as ProjectMemberRole,
          displayName: typeof profile?.display_name === 'string' ? profile.display_name : null,
          handle: typeof profile?.handle === 'string' ? profile.handle : null,
        }];
      });
    },

    async listCourses(courseIds, viewerBranchId) {
      if (courseIds.length === 0) return [];
      const courseResult = await database.from('courses').select('id,current_version_id').in('id', courseIds).eq('status', 'published');
      if (courseResult.error) databaseError('Related courses could not be loaded');
      const courses = rows(courseResult.data);
      const versionIds = courses.flatMap((row) => typeof row.current_version_id === 'string' ? [row.current_version_id] : []);
      if (versionIds.length === 0) return [];
      const outlineResult = await database.from('course_version_outline').select('version_id,meta,access').in('version_id', versionIds);
      if (outlineResult.error) databaseError('Related course titles could not be loaded');
      const outlines = new Map(rows(outlineResult.data).flatMap((row) => typeof row.version_id === 'string' ? [[row.version_id, row] as const] : []));
      return courses.flatMap((row): ProjectCourse[] => {
        if (typeof row.id !== 'string' || typeof row.current_version_id !== 'string') return [];
        const outline = outlines.get(row.current_version_id);
        if (!outline) return [];
        const access = branchScopeOf(outline.access);
        if (!access || (viewerBranchId !== undefined && !projectScopeAllows(access, viewerBranchId))) return [];
        return [{ id: row.id, title: localized(record(outline.meta)?.title) }];
      });
    },

    async hasInterest(projectId, userId) {
      const { data, error } = await database.from('project_interest').select('project_id').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
      if (error) databaseError('Project interest could not be loaded');
      return record(data)?.project_id === projectId;
    },

    async setInterest(projectId, userId, interested) {
      const result = interested
        ? await database.from('project_interest').upsert(
          { project_id: projectId, user_id: userId, updated_at: new Date().toISOString() },
          { onConflict: 'project_id,user_id', ignoreDuplicates: true },
        )
        : await database.from('project_interest').delete().eq('project_id', projectId).eq('user_id', userId);
      if (result.error) databaseError('Project interest could not be saved');
    },

    async listInterests(projectId) {
      const interestResult = await database.from('project_interest').select('user_id').eq('project_id', projectId).order('created_at', { ascending: true });
      if (interestResult.error) databaseError('Project interest list could not be loaded');
      const userIds = rows(interestResult.data).flatMap((row) => typeof row.user_id === 'string' ? [row.user_id] : []);
      if (userIds.length === 0) return [];
      const profileResult = await database.from('profiles').select('id,display_name,handle').in('id', userIds);
      if (profileResult.error) databaseError('Interested learner profiles could not be loaded');
      return rows(profileResult.data).flatMap((row): ProjectInterestPerson[] => typeof row.id === 'string' ? [{
        userId: row.id,
        displayName: typeof row.display_name === 'string' ? row.display_name : null,
        handle: typeof row.handle === 'string' ? row.handle : null,
      }] : []);
    },

    async trackView(projectId, userId) {
      await database.from('analytics_events').insert({
        user_id: userId,
        name: 'project.viewed',
        props: { projectId },
      });
    },
  };
}

function splitValues(values: string[]): string[] {
  return [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
}

export function projectFiltersFromUrl(url: string): ProjectFilters {
  const params = new URL(url).searchParams;
  const rawStatuses = splitValues(params.getAll('status'));
  const statuses = z.array(z.enum(PROJECT_STATUSES)).parse(rawStatuses);
  const skills = z.array(IdSchema).parse(splitValues(params.getAll('skill')));
  const courseIds = z.array(IdSchema).parse(splitValues(params.getAll('course')));
  return {
    ...(statuses.length ? { statuses } : {}),
    ...(skills.length ? { skills } : {}),
    ...(courseIds.length ? { courseIds } : {}),
  };
}

async function productionService() {
  const [{ supabaseService }, permissions] = await Promise.all([
    import('@/lib/supabase/server'),
    import('@/lib/permissions'),
  ]);
  return createProjectService({
    store: createSupabaseProjectStore(supabaseService() as unknown as ProjectDatabase),
    authorize: permissions.requirePermission,
  });
}

export async function listProjects(viewerId: string, filters: ProjectFilters = {}) {
  return (await productionService()).list(viewerId, filters);
}

export async function getProject(viewerId: string, id: string) {
  return (await productionService()).get(viewerId, id);
}

export async function proposeProject(viewerId: string, input: unknown) {
  return (await productionService()).propose(viewerId, input);
}

export async function setProjectInterest(viewerId: string, id: string, interested: boolean) {
  return (await productionService()).setInterest(viewerId, id, interested);
}

export async function canViewProjectCover(viewerId: string, assetId: string) {
  return (await productionService()).canViewCover(viewerId, assetId);
}

export async function canReviewProjectCover(actor: Actor, assetId: string) {
  return (await productionService()).canReviewCover(actor, assetId);
}

export async function listStudioProjects(filters: ProjectFilters = {}) {
  return (await productionService()).listStudio(filters);
}

export async function getStudioProject(id: string) {
  return (await productionService()).getStudio(id);
}

export async function createStudioProject(input: unknown) {
  return (await productionService()).createStudio(input);
}

export async function updateStudioProject(id: string, input: unknown) {
  return (await productionService()).updateStudio(id, input);
}

export async function deleteStudioProject(id: string) {
  return (await productionService()).deleteStudio(id);
}
