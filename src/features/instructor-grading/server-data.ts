import 'server-only';

import {
  allowedBranchIds,
  hasGlobalPermission,
  type Actor,
  type BranchScopedPermission,
} from '@/lib/permissions';
import { supabaseService } from '@/lib/supabase/server';
import type {
  AssignmentMetadata,
  BranchOption,
  ExamOption,
  InstructorMetadata,
  InstructorRubric,
  LocalizedLabel,
} from './types';

type MetadataRows = {
  versions: unknown[];
  outlines: unknown[];
  items: unknown[];
  renders: unknown[];
};

export type InstructorBranchScope = {
  global: boolean;
  branchIds: string[];
};

const PAGE_SIZE = 50;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function localized(value: unknown, locale: string): string | null {
  if (typeof value === 'string') return value;
  const labels = record(value);
  return stringValue(labels?.[locale]) ?? stringValue(labels?.vi) ?? stringValue(labels?.en);
}

function rubric(value: unknown): InstructorRubric | null {
  const raw = record(value);
  if (!raw || !Array.isArray(raw.criteria)) return null;
  const criteria = raw.criteria.flatMap((entry) => {
    const criterion = record(entry);
    if (!criterion) return [];
    const id = stringValue(criterion?.id);
    const name = criterion?.name;
    const maxPoints = criterion?.maxPoints;
    if (!id || (typeof name !== 'string' && !record(name))
      || typeof maxPoints !== 'number' || !Number.isFinite(maxPoints) || maxPoints < 0) return [];
    const levels = Array.isArray(criterion.levels)
      ? criterion.levels.flatMap((rawLevel) => {
        const level = record(rawLevel);
        if (!level || typeof level.points !== 'number' || !Number.isFinite(level.points)
          || (typeof level.label !== 'string' && !record(level.label))) return [];
        return [{
          points: level.points,
          label: level.label as LocalizedLabel,
          ...(typeof level.description === 'string' || record(level.description)
            ? { description: level.description as LocalizedLabel }
            : {}),
        }];
      })
      : undefined;
    return [{
      id,
      name: name as LocalizedLabel,
      maxPoints,
      ...(typeof criterion.description === 'string' || record(criterion.description)
        ? { description: criterion.description as LocalizedLabel }
        : {}),
      ...(levels?.length ? { levels } : {}),
    }];
  });
  return { criteria };
}

function outlineItemTitles(value: unknown, locale: string): Map<string, string> {
  const titles = new Map<string, string>();
  const modules = record(value)?.modules;
  if (!Array.isArray(modules)) return titles;
  for (const rawModule of modules) {
    const items = record(rawModule)?.items;
    if (!Array.isArray(items)) continue;
    for (const rawItem of items) {
      const item = record(rawItem);
      const id = stringValue(item?.id);
      const title = localized(item?.title, locale);
      if (id && title) titles.set(id, title);
    }
  }
  return titles;
}

export function buildInstructorMetadata(locale: string, rows: MetadataRows): InstructorMetadata {
  const outlines = new Map(rows.outlines.flatMap((value) => {
    const row = record(value);
    const versionId = stringValue(row?.version_id);
    return versionId ? [[versionId, row] as const] : [];
  }));
  const renders = new Map<string, string>();
  for (const value of rows.renders) {
    const row = record(value);
    const versionId = stringValue(row?.version_id);
    const itemId = stringValue(row?.item_id);
    const renderLocale = stringValue(row?.locale);
    const title = localized(record(row?.payload)?.title, locale);
    if (!versionId || !itemId || !title) continue;
    const key = `${versionId}:${itemId}`;
    if (renderLocale === locale || !renders.has(key)) renders.set(key, title);
  }

  const versions = rows.versions.flatMap((value) => {
    const row = record(value);
    const id = stringValue(row?.id);
    const courseId = stringValue(row?.course_id);
    const version = row?.version;
    if (!id || !courseId || typeof version !== 'number' || !Number.isSafeInteger(version)) return [];
    const outline = outlines.get(id);
    const courseTitle = localized(record(outline?.meta)?.title, locale) ?? courseId;
    return [{ id, courseId, version, courseTitle, itemTitles: outlineItemTitles(outline?.outline, locale) }];
  });
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const assignments: AssignmentMetadata[] = [];
  const exams: ExamOption[] = [];

  for (const value of rows.items) {
    const row = record(value);
    const versionId = stringValue(row?.version_id);
    const itemId = stringValue(row?.item_id);
    const kind = stringValue(row?.kind);
    const version = versionId ? versionById.get(versionId) : undefined;
    if (!version || !itemId) continue;
    const itemTitle = renders.get(`${version.id}:${itemId}`)
      ?? version.itemTitles.get(itemId)
      ?? (locale === 'vi' ? 'Mục chưa có tiêu đề' : 'Untitled item');
    if (kind === 'exam') {
      exams.push({
        courseId: version.courseId,
        courseTitle: version.courseTitle,
        courseVersionId: version.id,
        version: version.version,
        itemId,
        itemTitle,
      });
      continue;
    }
    const grading = record(row?.grading);
    const rubrics = record(grading?.rubrics) ?? {};
    const assignmentSettings = record(grading?.assignments) ?? {};
    const assignmentIds = new Set([
      ...Object.keys(rubrics),
      ...Object.keys(assignmentSettings),
      ...(kind === 'assignment' ? [itemId] : []),
    ]);
    for (const assignmentId of assignmentIds) {
      assignments.push({
        courseId: version.courseId,
        courseTitle: version.courseTitle,
        courseVersionId: version.id,
        version: version.version,
        itemId,
        itemTitle,
        assignmentId,
        rubric: rubric(rubrics[assignmentId]) ?? { criteria: [] },
      });
    }
  }

  const courseMap = new Map(versions.map(({ courseId, courseTitle }) => [courseId, courseTitle]));
  return {
    courses: [...courseMap].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title)),
    assignments,
    exams: exams.sort((a, b) => a.courseTitle.localeCompare(b.courseTitle)
      || b.version - a.version || a.itemTitle.localeCompare(b.itemTitle)),
  };
}

export function deriveBranchOptions(
  actor: Actor,
  branches: readonly BranchOption[],
  permission: BranchScopedPermission,
): BranchOption[] {
  if (hasGlobalPermission(actor, permission)) return [...branches];
  const allowed = new Set(allowedBranchIds(actor, permission));
  return branches.filter(({ id }) => allowed.has(id));
}

export function instructorBranchScope(
  actor: Actor,
  permission: BranchScopedPermission,
): InstructorBranchScope {
  if (hasGlobalPermission(actor, permission)) return { global: true, branchIds: [] };

  return {
    global: false,
    branchIds: allowedBranchIds(actor, permission),
  };
}

function rows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type PagedResult = { data: unknown; error: unknown };
type PagedQuery = { range(from: number, to: number): PromiseLike<PagedResult> };

async function loadPagedRows(
  createQuery: () => PagedQuery,
  failureMessage: string,
): Promise<unknown[]> {
  const loaded: unknown[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await createQuery().range(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error(failureMessage);
    const page = rows(result.data);
    loaded.push(...page);
    if (page.length < PAGE_SIZE) return loaded;
  }
}

function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += PAGE_SIZE) {
    result.push(values.slice(index, index + PAGE_SIZE));
  }
  return result;
}

export async function loadInstructorPageData(
  locale: string,
  scope: InstructorBranchScope,
): Promise<{
  branches: BranchOption[];
  metadata: InstructorMetadata;
}> {
  const database = supabaseService();
  const [branchRows, enrollmentRows] = await Promise.all([
    loadPagedRows(() => {
      let query = database.from('branches').select('id,name');
      if (!scope.global) query = query.in('id', scope.branchIds);
      return query.order('name').order('id') as unknown as PagedQuery;
    }, 'Instructor grading branches could not be loaded'),
    loadPagedRows(() => {
      let query = database.from('enrollments')
        .select('id,course_version_id,branch_id,branch_scope_known')
        .in('status', ['active', 'completed']);
      if (!scope.global) {
        query = query.eq('branch_scope_known', true).in('branch_id', scope.branchIds);
      }
      return query.order('course_version_id').order('id') as unknown as PagedQuery;
    }, 'Instructor grading enrollments could not be loaded'),
  ]);
  const branches = branchRows.flatMap((value) => {
    const row = record(value);
    const id = stringValue(row?.id);
    const name = stringValue(row?.name);
    return id && name ? [{ id, name }] : [];
  });
  const enrolledVersionIds = [...new Set(enrollmentRows.flatMap((value) => {
    const id = stringValue(record(value)?.course_version_id);
    return id ? [id] : [];
  }))];
  const versionRows: unknown[] = [];
  for (const versionIdPage of chunks(enrolledVersionIds)) {
    versionRows.push(...await loadPagedRows(
      () => database.from('course_versions')
        .select('id,course_id,version')
        .in('id', versionIdPage)
        .order('published_at', { ascending: false })
        .order('id') as unknown as PagedQuery,
      'Instructor grading versions could not be loaded',
    ));
  }
  const versionIds = versionRows.flatMap((value) => {
    const id = stringValue(record(value)?.id);
    return id ? [id] : [];
  });
  if (!versionIds.length) {
    return { branches, metadata: { courses: [], assignments: [], exams: [] } };
  }
  const outlines: unknown[] = [];
  const items: unknown[] = [];
  const renders: unknown[] = [];
  for (const versionIdPage of chunks(versionIds)) {
    const [outlinePage, itemPage, renderPage] = await Promise.all([
      loadPagedRows(
        () => database.from('course_version_outline')
          .select('version_id,course_id,meta,outline')
          .in('version_id', versionIdPage)
          .order('version_id') as unknown as PagedQuery,
        'Instructor course outlines could not be loaded',
      ),
      loadPagedRows(
        () => database.from('course_version_items')
          .select('version_id,item_id,kind,grading')
          .in('version_id', versionIdPage)
          .order('version_id')
          .order('item_id') as unknown as PagedQuery,
        'Instructor course items could not be loaded',
      ),
      loadPagedRows(
        () => database.from('course_version_item_renders')
          .select('version_id,item_id,locale,payload')
          .in('version_id', versionIdPage)
          .order('version_id')
          .order('item_id')
          .order('locale') as unknown as PagedQuery,
        'Instructor course renders could not be loaded',
      ),
    ]);
    outlines.push(...outlinePage);
    items.push(...itemPage);
    renders.push(...renderPage);
  }
  return {
    branches,
    metadata: buildInstructorMetadata(locale, {
      versions: versionRows,
      outlines,
      items,
      renders,
    }),
  };
}
