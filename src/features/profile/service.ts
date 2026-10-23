import 'server-only';

import type { L10nString } from '@/content-engine';
import { passport, type PassportSkill, type SkillsDatabase } from '@/features/skills/service';
import { ApiError } from '@/lib/api';
import { audit } from '@/lib/audit';
import type { Actor } from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import {
  readPublicCertificates,
  type CertificateDatabase,
  type PublicCertificate,
  type PublicCertificateReader,
} from './certificates';

export const PROFILE_HANDLE_PATTERN = /^[a-z0-9][a-z0-9_-]{2,31}$/;

type QueryResult = { data: unknown; error: unknown | null };

export interface ProfileQuery extends PromiseLike<QueryResult> {
  select(columns: string): ProfileQuery;
  eq(column: string, value: unknown): ProfileQuery;
  in(column: string, values: unknown[]): ProfileQuery;
  order(column: string, options?: unknown): ProfileQuery;
  limit(value: number): ProfileQuery;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

interface ProfileMutationQuery extends ProfileQuery {
  update(value: unknown): ProfileMutationQuery;
}

export interface ProfileDatabase {
  from(table: string): ProfileQuery;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<QueryResult>;
}

export type ProfileDependencies = {
  client?: ProfileDatabase;
  certificates?: PublicCertificateReader;
  now?: () => Date;
};

export type PublicCompletedCourse = {
  id: string;
  title: L10nString;
  completedAt: string;
};

export type OwnerCompletedCourse = PublicCompletedCourse & { currentDestinationAvailable: boolean };

export type PublicProject = {
  id: string;
  title: L10nString;
  summary: L10nString;
  outputLinks: Array<{ url: string; label?: string }>;
};

export type PublicProfile = {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  branch: { name: string } | null;
  completedCourses: PublicCompletedCourse[];
  skills: Array<Pick<PassportSkill, 'id' | 'name' | 'category' | 'level'> & { evidenceCount: number }>;
  certificates: PublicCertificate[];
  projects: PublicProject[];
};

export type ProfileSettings = {
  handle: string | null;
  displayName: string;
  profilePublic: boolean;
};

function database(deps?: ProfileDependencies): ProfileDatabase {
  return deps?.client ?? (supabaseService() as unknown as ProfileDatabase);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const row = record(entry);
    return row ? [row] : [];
  }) : [];
}

function oneRecord(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? record(value[0]) : record(value);
}

function localized(value: unknown): L10nString {
  if (typeof value === 'string') return value;
  const map = record(value);
  return map && (typeof map.vi === 'string' || typeof map.en === 'string')
    ? map as L10nString
    : '';
}

function errorDetails(error: unknown): Record<string, unknown> {
  return record(error) ?? {};
}

function errorHas(error: unknown, marker: string): boolean {
  const details = errorDetails(error);
  return [details.message, details.details, details.hint]
    .some((value) => typeof value === 'string' && value.includes(marker));
}

function databaseFailure(message: string): never {
  throw new ApiError(500, 'PROFILE_DATABASE_ERROR', message);
}

async function completedCourses(
  userId: string,
  client: ProfileDatabase,
): Promise<PublicCompletedCourse[]> {
  const completionResult = await client.from('course_completions')
    .select('course_id,course_version_id,completed_at')
    .eq('user_id', userId)
    .order('completed_at', { ascending: false });
  if (completionResult.error) databaseFailure('Unable to load completed courses');
  const completions = records(completionResult.data);
  const courseIds = [...new Set(completions.flatMap((completion) => (
    typeof completion.course_id === 'string' ? [completion.course_id] : []
  )))];
  const courseResult = courseIds.length
    ? await client.from('courses')
      .select('id,current_version_id,status')
      .in('id', courseIds)
      .eq('status', 'published')
    : { data: [], error: null };
  if (courseResult.error) databaseFailure('Unable to load published courses');
  const publishedCourses = new Map(records(courseResult.data).flatMap((course) => (
    typeof course.id === 'string' && typeof course.current_version_id === 'string'
      ? [[course.id, course.current_version_id] as const]
      : []
  )));
  const currentVersionIds = [...new Set(publishedCourses.values())];
  const [versionResult, outlineResult] = currentVersionIds.length
    ? await Promise.all([
      client.from('course_versions').select('id,course_id,manifest').in('id', currentVersionIds),
      client.from('course_version_outline').select('version_id,access').in('version_id', currentVersionIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (versionResult.error || outlineResult.error) databaseFailure('Unable to load public course details');
  const globallyVisibleVersions = new Set(records(outlineResult.data).flatMap((outline) => (
    typeof outline.version_id === 'string' && record(outline.access)?.scope === 'global'
      ? [outline.version_id]
      : []
  )));
  const manifests = new Map(records(versionResult.data).flatMap((version) => (
    typeof version.id === 'string' ? [[version.id, version.manifest] as const] : []
  )));
  return completions.flatMap((completion): PublicCompletedCourse[] => {
    const currentVersionId = typeof completion.course_id === 'string'
      ? publishedCourses.get(completion.course_id)
      : undefined;
    if (
      typeof completion.course_id !== 'string'
      || typeof completion.completed_at !== 'string'
      || !currentVersionId
      || !globallyVisibleVersions.has(currentVersionId)
    ) return [];
    return [{
      id: completion.course_id,
      title: localized(record(manifests.get(currentVersionId))?.title),
      completedAt: completion.completed_at,
    }];
  });
}

function projectOf(value: Record<string, unknown>, branchId?: string | null): PublicProject | null {
  const scope = record(value.branch_scope);
  if (typeof value.id !== 'string' || value.status !== 'showcased' || value.approved !== true
    || (branchId === undefined
      ? scope?.scope !== 'global'
      : scope?.scope !== 'global' && !(scope?.scope === 'branches' && branchId && Array.isArray(scope.branchIds) && scope.branchIds.includes(branchId)))) return null;
  const outputLinks = Array.isArray(value.output_links) ? value.output_links.flatMap((entry) => {
    const link = record(entry);
    if (!link || typeof link.url !== 'string') return [];
    try {
      const url = new URL(link.url);
      if (url.protocol !== 'https:') return [];
      return [{
        url: url.toString(),
        ...(typeof link.label === 'string' && link.label.length ? { label: link.label } : {}),
      }];
    } catch {
      return [];
    }
  }) : [];
  return {
    id: value.id,
    title: localized(value.title),
    summary: localized(value.summary),
    outputLinks,
  };
}

async function showcasedProjects(userId: string, client: ProfileDatabase): Promise<PublicProject[]> {
  const [ownedResult, membershipResult] = await Promise.all([
    client.from('projects')
      .select('id,title,summary,output_links,owner_id,status,approved,branch_scope')
      .eq('owner_id', userId)
      .eq('status', 'showcased')
      .eq('approved', true)
      .eq('branch_scope->>scope', 'global'),
    client.from('project_members')
      .select('project_id')
      .eq('user_id', userId),
  ]);
  if (ownedResult.error || membershipResult.error) databaseFailure('Unable to load showcased projects');
  const memberIds = [...new Set(records(membershipResult.data).flatMap((membership) => (
    typeof membership.project_id === 'string' ? [membership.project_id] : []
  )))];
  const memberResult = memberIds.length
    ? await client.from('projects')
      .select('id,title,summary,output_links,owner_id,status,approved,branch_scope')
      .in('id', memberIds)
      .eq('status', 'showcased')
      .eq('approved', true)
      .eq('branch_scope->>scope', 'global')
    : { data: [], error: null };
  if (memberResult.error) databaseFailure('Unable to load showcased projects');
  const byId = new Map<string, PublicProject>();
  for (const row of [...records(ownedResult.data), ...records(memberResult.data)]) {
    const project = projectOf(row);
    if (project) byId.set(project.id, project);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function ownerCompletedCourses(userId: string, branchId: string | null, client: ProfileDatabase) {
  const completionResult = await client.from('course_completions').select('course_id,course_version_id,completed_at').eq('user_id', userId).order('completed_at', { ascending: false });
  if (completionResult.error) databaseFailure('Unable to load owner course evidence');
  const completions = records(completionResult.data);
  const courseIds = [...new Set(completions.flatMap((row) => typeof row.course_id === 'string' ? [row.course_id] : []))];
  const versionIds = [...new Set(completions.flatMap((row) => typeof row.course_version_id === 'string' ? [row.course_version_id] : []))];
  const [coursesResult, versionsResult] = await Promise.all([
    courseIds.length ? client.from('courses').select('id,status,current_version_id').in('id', courseIds).eq('status', 'published') : Promise.resolve({ data: [], error: null }),
    versionIds.length ? client.from('course_versions').select('id,course_id,manifest').in('id', versionIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (coursesResult.error || versionsResult.error) databaseFailure('Unable to load owner course evidence');
  const currentVersions = new Map(records(coursesResult.data).flatMap((row) => row.status === 'published'
    && typeof row.id === 'string' && typeof row.current_version_id === 'string'
    ? [[row.id, row.current_version_id] as const]
    : []));
  const currentVersionIds = [...new Set(currentVersions.values())];
  const currentOutlinesResult = currentVersionIds.length
    ? await client.from('course_version_outline').select('version_id,access').in('version_id', currentVersionIds)
    : { data: [], error: null };
  if (currentOutlinesResult.error) databaseFailure('Unable to load owner course evidence');
  const versions = new Map(records(versionsResult.data).flatMap((row) => typeof row.id === 'string' ? [[row.id, row] as const] : []));
  const currentAccess = new Map(records(currentOutlinesResult.data).flatMap((row) => typeof row.version_id === 'string' ? [[row.version_id, row.access] as const] : []));
  return completions.flatMap((completion): OwnerCompletedCourse[] => {
    if (typeof completion.course_id !== 'string' || typeof completion.course_version_id !== 'string' || typeof completion.completed_at !== 'string') return [];
    const currentVersionId = currentVersions.get(completion.course_id);
    if (!currentVersionId) return [];
    const version = versions.get(completion.course_version_id);
    if (!version || version.course_id !== completion.course_id) return [];
    const scope = record(currentAccess.get(currentVersionId));
    const currentDestinationAvailable = scope?.scope === 'global'
      || Boolean(scope?.scope === 'branches' && branchId && Array.isArray(scope.branchIds) && scope.branchIds.includes(branchId));
    return [{
      id: completion.course_id,
      title: localized(record(version.manifest)?.title),
      completedAt: completion.completed_at,
      currentDestinationAvailable,
    }];
  });
}

async function ownerShowcasedProjects(userId: string, branchId: string | null, client: ProfileDatabase) {
  const [ownedResult, membershipResult] = await Promise.all([
    client.from('projects').select('id,title,summary,output_links,owner_id,status,approved,branch_scope').eq('owner_id', userId).eq('status', 'showcased').eq('approved', true),
    client.from('project_members').select('project_id').eq('user_id', userId),
  ]);
  if (ownedResult.error || membershipResult.error) databaseFailure('Unable to load owner project evidence');
  const memberIds = [...new Set(records(membershipResult.data).flatMap((row) => typeof row.project_id === 'string' ? [row.project_id] : []))];
  const memberResult = memberIds.length ? await client.from('projects').select('id,title,summary,output_links,owner_id,status,approved,branch_scope').in('id', memberIds).eq('status', 'showcased').eq('approved', true) : { data: [], error: null };
  if (memberResult.error) databaseFailure('Unable to load owner project evidence');
  const byId = new Map<string, PublicProject>();
  for (const row of [...records(ownedResult.data), ...records(memberResult.data)]) { const project = projectOf(row, branchId); if (project) byId.set(project.id, project); }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export async function getOwnerProfileEvidence(userId: string, deps?: ProfileDependencies) {
  const client = database(deps);
  const profileResult = await client.from('profiles').select('branch_id').eq('id', userId).maybeSingle();
  if (profileResult.error) databaseFailure('Unable to load owner profile evidence');
  const branchValue = record(profileResult.data)?.branch_id;
  const branchId = typeof branchValue === 'string' ? branchValue : null;
  const [courses, skills, projects] = await Promise.all([
    ownerCompletedCourses(userId, branchId, client),
    passport(userId, { client: client as unknown as SkillsDatabase }),
    ownerShowcasedProjects(userId, branchId, client),
  ]);
  return {
    completedCourses: courses,
    skills,
    projects,
  };
}

/** Returns null for private, missing, and syntactically invalid handles alike. */
export async function getPublicProfile(
  handle: string,
  deps?: ProfileDependencies,
): Promise<PublicProfile | null> {
  if (!PROFILE_HANDLE_PATTERN.test(handle)) return null;
  const client = database(deps);
  const profileResult = await client.from('public_profiles')
    .select('id,handle,display_name,avatar_url,branch_name')
    .eq('handle', handle)
    .maybeSingle();
  if (profileResult.error) databaseFailure('Unable to load public profile');
  const profile = record(profileResult.data);
  if (
    !profile
    || typeof profile.id !== 'string'
    || typeof profile.handle !== 'string'
    || typeof profile.display_name !== 'string'
  ) return null;

  const certificateReader = deps?.certificates ?? readPublicCertificates;
  const [courses, skillRows, certificates, projects] = await Promise.all([
    completedCourses(profile.id, client),
    passport(profile.id, { client: client as unknown as SkillsDatabase }),
    certificateReader(profile.id, client as unknown as CertificateDatabase),
    showcasedProjects(profile.id, client),
  ]);

  return {
    handle: profile.handle,
    displayName: profile.display_name,
    avatarUrl: typeof profile.avatar_url === 'string' ? profile.avatar_url : null,
    branch: typeof profile.branch_name === 'string'
      ? { name: profile.branch_name }
      : null,
    completedCourses: courses,
    skills: skillRows.map(({ evidence, ...skill }) => ({ ...skill, evidenceCount: evidence.length })),
    certificates,
    projects,
  };
}

export async function getProfileSettings(
  userId: string,
  deps?: ProfileDependencies,
): Promise<ProfileSettings> {
  const result = await database(deps).from('profiles')
    .select('handle,display_name,profile_public')
    .eq('id', userId)
    .maybeSingle();
  if (result.error) databaseFailure('Unable to load profile settings');
  const profile = record(result.data);
  if (!profile || typeof profile.display_name !== 'string' || typeof profile.profile_public !== 'boolean') {
    throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  }
  return {
    handle: typeof profile.handle === 'string' ? profile.handle : null,
    displayName: profile.display_name,
    profilePublic: profile.profile_public,
  };
}

export async function changeHandle(
  actor: Actor,
  handle: string,
  deps?: ProfileDependencies,
): Promise<{ handle: string }> {
  if (!PROFILE_HANDLE_PATTERN.test(handle)) {
    throw new ApiError(400, 'INVALID_HANDLE', 'Handle must match the required format');
  }
  const client = database(deps);
  const beforeResult = await client.from('profiles')
    .select('id,handle')
    .eq('id', actor.userId)
    .maybeSingle();
  if (beforeResult.error) databaseFailure('Unable to load current profile handle');
  const before = record(beforeResult.data);
  if (!before || before.id !== actor.userId) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');

  const result = await client.rpc('profile_change_handle', {
    p_user_id: actor.userId,
    p_handle: handle,
    p_now: (deps?.now?.() ?? new Date()).toISOString(),
  });
  if (result.error) {
    const details = errorDetails(result.error);
    if (details.code === '23505') throw new ApiError(409, 'HANDLE_TAKEN', 'Handle is already in use');
    if (errorHas(result.error, 'HANDLE_RATE_LIMITED')) {
      throw new ApiError(429, 'HANDLE_RATE_LIMITED', 'Handle can only be changed three times per day');
    }
    if (errorHas(result.error, 'PROFILE_NOT_FOUND')) {
      throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
    }
    databaseFailure('Unable to update profile handle');
  }
  const updated = oneRecord(result.data);
  if (updated?.outcome === 'HANDLE_TAKEN') {
    throw new ApiError(409, 'HANDLE_TAKEN', 'Handle is already in use');
  }
  if (updated?.outcome === 'HANDLE_RATE_LIMITED') {
    throw new ApiError(429, 'HANDLE_RATE_LIMITED', 'Handle can only be changed three times per day');
  }
  const updatedHandle = typeof updated?.handle === 'string' ? updated.handle : handle;
  if (before.handle !== updatedHandle) {
    await audit(
      actor,
      'profile.handle.updated',
      { type: 'profile', id: actor.userId },
      { handle: typeof before.handle === 'string' ? before.handle : null },
      { handle: updatedHandle },
    );
  }
  return { handle: updatedHandle };
}

export async function setProfilePublic(
  actor: Actor,
  profilePublic: boolean,
  deps?: ProfileDependencies,
): Promise<{ profilePublic: boolean }> {
  const client = database(deps);
  const beforeResult = await client.from('profiles')
    .select('id,profile_public')
    .eq('id', actor.userId)
    .maybeSingle();
  if (beforeResult.error) databaseFailure('Unable to load current profile visibility');
  const before = record(beforeResult.data);
  if (!before || before.id !== actor.userId || typeof before.profile_public !== 'boolean') {
    throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  }

  const query = client.from('profiles') as ProfileMutationQuery;
  const result = await query.update({
    profile_public: profilePublic,
    updated_at: (deps?.now?.() ?? new Date()).toISOString(),
  })
    .eq('id', actor.userId)
    .select('id,profile_public')
    .single();
  if (result.error) databaseFailure('Unable to update profile visibility');
  const profile = record(result.data);
  if (!profile || profile.id !== actor.userId) throw new ApiError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  const updatedPublic = profile.profile_public === true;
  if (before.profile_public !== updatedPublic) {
    await audit(
      actor,
      'profile.visibility.updated',
      { type: 'profile', id: actor.userId },
      { profilePublic: before.profile_public },
      { profilePublic: updatedPublic },
    );
  }
  return { profilePublic: updatedPublic };
}
