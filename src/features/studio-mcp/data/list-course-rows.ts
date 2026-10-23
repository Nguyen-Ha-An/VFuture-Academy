import type { Actor, Scope } from '@/lib/permissions';

import { canMcpAuthor, mcpReadableScopes } from '../authz/capabilities';
import type { ReadOnlyDatabase } from '../db/read-only-database';
import { StudioMcpError } from '../errors';
import { courseLanguages, defaultTitle, ownerScopeKey, record } from './courses';

function scopeKey(scope: Scope): string {
  return scope.kind === 'central' ? 'central' : `branch:${scope.branchId}`;
}

function ownerScope(key: string): Scope {
  return key === 'central' ? { kind: 'central' } : { kind: 'branch', branchId: key.slice('branch:'.length) };
}

export type ListCourseOptions = {
  scope?: string;
  query?: string;
  status?: 'draft' | 'published' | 'archived';
  limit: number;
  offset: number;
};

export async function mcpListCourses(
  db: ReadOnlyDatabase,
  actor: Actor,
  resourceOrigin: string,
  options: ListCourseOptions,
): Promise<{
  scope: string;
  courses: Array<{
    courseId: string;
    title: string;
    languages: ('vi' | 'en')[];
    status: 'draft' | 'published' | 'archived';
    ownerScopeKey: string;
    draftUpdatedAt: string | null;
    canEdit: boolean;
    studioUrl: string;
  }>;
  total: number;
  nextOffset: number | null;
}> {
  const readable = mcpReadableScopes(actor);
  const selected = options.scope
    ? readable.find((scope) => scopeKey(scope) === options.scope)
    : readable[0];
  if (!selected) throw new StudioMcpError('INVALID_SCOPE');

  const normalizedQuery = options.query?.trim().toLocaleLowerCase() ?? '';
  const page: Array<{
    courseId: string; title: string; languages: ('vi' | 'en')[];
    status: 'draft' | 'published' | 'archived'; ownerScopeKey: string;
    draftUpdatedAt: string | null; canEdit: boolean; studioUrl: string;
  }> = [];
  let total = 0;
  const batchSize = 200;
  for (let start = 0; ; start += batchSize) {
    let query = db.from('courses')
      .select('id,status,ownership_kind,owner_branch_id,updated_at')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true });
    if (selected.kind === 'branch') query = query.eq('ownership_kind', 'branch').eq('owner_branch_id', selected.branchId);
    if (options.status) query = query.eq('status', options.status);
    const { data, error } = await query.range(start, start + batchSize - 1);
    if (error || !Array.isArray(data)) throw new StudioMcpError('SERVICE_UNAVAILABLE');
    const courseRows = data.map(record).filter((row): row is Record<string, unknown> => row !== null);
    const ids = courseRows.flatMap((row) => typeof row.id === 'string' ? [row.id] : []);
    const draftByCourse = new Map<string, Record<string, unknown>>();
    if (ids.length) {
      const drafts = await db.from('course_drafts')
        .select('course_id,manifest,updated_at')
        .in('course_id', ids);
      if (drafts.error || !Array.isArray(drafts.data)) throw new StudioMcpError('SERVICE_UNAVAILABLE');
      for (const value of drafts.data) {
        const row = record(value);
        if (row && typeof row.course_id === 'string') draftByCourse.set(row.course_id, row);
      }
    }
    for (const row of courseRows) {
      const courseId = typeof row.id === 'string' ? row.id : null;
      const status = row.status;
      if (!courseId || (status !== 'draft' && status !== 'published' && status !== 'archived')) continue;
      const draft = draftByCourse.get(courseId);
      const manifest = record(draft?.manifest);
      const { languages, defaultLanguage } = courseLanguages(manifest);
      const title = defaultTitle(manifest?.title, defaultLanguage) || courseId;
      if (normalizedQuery && !`${courseId} ${title}`.toLocaleLowerCase().includes(normalizedQuery)) continue;
      if (total >= options.offset && page.length < options.limit) {
        const owner = ownerScopeKey(row);
        page.push({
          courseId, title, languages, status, ownerScopeKey: owner,
          draftUpdatedAt: typeof draft?.updated_at === 'string' ? draft.updated_at : null,
          canEdit: canMcpAuthor(actor, ownerScope(owner)),
          studioUrl: `${resourceOrigin}/studio/courses/${courseId}`,
        });
      }
      total += 1;
    }
    if (data.length < batchSize) break;
  }
  return {
    scope: scopeKey(selected),
    courses: page,
    total,
    nextOffset: options.offset + options.limit < total ? options.offset + options.limit : null,
  };
}
