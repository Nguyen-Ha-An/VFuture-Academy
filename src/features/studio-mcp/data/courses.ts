import { checksumOf } from '@/content-engine/compile/checksum';
import type { CourseDraft } from '@/features/studio/drafts';

type JsonObject = Record<string, unknown>;
type ItemKind = 'lesson' | 'exam' | 'assignment';

const itemKinds = new Set<ItemKind>(['lesson', 'exam', 'assignment']);

export function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : null;
}

function rows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function kind(value: unknown): ItemKind | null {
  return typeof value === 'string' && itemKinds.has(value as ItemKind) ? value as ItemKind : null;
}

export function ownerScopeKey(course: JsonObject): string {
  return course.ownership_kind === 'branch' && string(course.owner_branch_id)
    ? `branch:${course.owner_branch_id}` : 'central';
}

export function courseLanguages(manifest: unknown): { languages: ('vi' | 'en')[]; defaultLanguage: 'vi' | 'en' } {
  const source = record(manifest);
  const languages = rows(source?.languages).filter((value): value is 'vi' | 'en' => value === 'vi' || value === 'en');
  const defaultLanguage = source?.defaultLanguage === 'en' ? 'en' : 'vi';
  return { languages, defaultLanguage };
}

export function defaultTitle(value: unknown, language: 'vi' | 'en'): string {
  if (typeof value === 'string') return value;
  const title = record(value);
  return string(title?.[language]) ?? string(title?.vi) ?? string(title?.en) ?? '';
}

export function findDraftItem(draft: CourseDraft, itemId: string): {
  moduleId: string;
  moduleTitle: unknown;
  kind: ItemKind;
  title: unknown;
  document: unknown;
} | null {
  const manifest = record(draft.manifest);
  for (const moduleValue of rows(manifest?.modules)) {
    const courseModule = record(moduleValue);
    const moduleId = string(courseModule?.id);
    if (!moduleId) continue;
    for (const itemValue of rows(courseModule?.items)) {
      const item = record(itemValue);
      const itemKind = kind(item?.type);
      if (item?.id === itemId && itemKind && Object.hasOwn(draft.items, itemId)) {
        return {
          moduleId,
          moduleTitle: courseModule?.title,
          kind: itemKind,
          title: item?.title,
          document: draft.items[itemId],
        };
      }
    }
  }
  return null;
}

function questionCounts(value: unknown): { questionCount: number; bankRefCount: number } {
  let questionCount = 0;
  let bankRefCount = 0;
  for (const entryValue of rows(value)) {
    const entry = record(entryValue);
    if (!entry) continue;
    if (typeof entry.$ref === 'string') { bankRefCount += 1; questionCount += 1; continue; }
    const pool = record(entry.$pool);
    if (pool) {
      if (Number.isSafeInteger(pool.count) && (pool.count as number) > 0) questionCount += pool.count as number;
      continue;
    }
    if (entry.type === 'question_group') {
      const child = questionCounts(entry.questions);
      questionCount += child.questionCount;
      bankRefCount += child.bankRefCount;
    } else questionCount += 1;
  }
  return { questionCount, bankRefCount };
}

function quizBlocks(document: unknown): Array<{ blockId: string; pointer: string; questionCount: number; bankRefCount: number }> {
  const blocks: Array<{ blockId: string; pointer: string; questionCount: number; bankRefCount: number }> = [];
  const visited = new WeakSet<object>();
  function visit(value: unknown, pointer: string, depth: number): void {
    if (depth > 32 || value === null || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${pointer}/${index}`, depth + 1));
      return;
    }
    const node = value as JsonObject;
    if (node.type === 'quiz' && typeof node.id === 'string') {
      blocks.push({ blockId: node.id, pointer, ...questionCounts(node.questions) });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key !== 'blocks' && key !== 'children' && key !== 'panels' && key !== 'steps' && key !== 'items' && key !== 'tabs') continue;
      visit(child, `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, depth + 1);
    }
  }
  visit(record(document)?.blocks, '/blocks', 0);
  return blocks;
}

export type OutlineSelection = { moduleOffset?: number; moduleLimit?: number; moduleId?: string; itemId?: string };

export async function outlineFromDraft(draft: CourseDraft, canEdit: boolean, selection: OutlineSelection = {}): Promise<{
  title: unknown;
  languages: ('vi' | 'en')[];
  defaultLanguage: 'vi' | 'en';
  draft: { updatedAt: string | null; revision: string };
  moduleTotal: number;
  nextModuleOffset: number | null;
  detailsOmitted: boolean;
  modules: Array<{
    moduleId: string;
    title: unknown;
    items: Array<{
      itemId: string;
      kind: ItemKind;
      title: unknown;
      itemHash?: string;
      quizBlocks?: ReturnType<typeof quizBlocks>;
      examSections?: Array<{ sectionId: string; pointer: string; questionCount: number; timed: boolean }>;
      blockCount?: number;
    }>;
  }>;
}> {
  const manifest = record(draft.manifest);
  const allModules = rows(manifest?.modules);
  const offset = selection.moduleOffset ?? 0;
  const limit = selection.moduleLimit ?? 1;
  const selectedModules = selection.itemId
    ? allModules.filter((value) => rows(record(value)?.items).some((item) => record(item)?.id === selection.itemId))
    : selection.moduleId
      ? allModules.filter((value) => record(value)?.id === selection.moduleId)
      : allModules.slice(offset, offset + limit);
  const modules = await Promise.all(selectedModules.map(async (moduleValue) => {
    const courseModule = record(moduleValue);
    const moduleId = string(courseModule?.id);
    if (!courseModule || !moduleId) return null;
    const selectedItems = selection.itemId
      ? rows(courseModule.items).filter((item) => record(item)?.id === selection.itemId)
      : rows(courseModule.items);
    const items = await Promise.all(selectedItems.map(async (itemValue) => {
      const item = record(itemValue);
      const itemId = string(item?.id);
      const itemKind = kind(item?.type);
      if (!item || !itemId || !itemKind) return null;
      const document = draft.items[itemId];
      const source = record(document);
      const itemHash = canEdit && source ? `sha256:${await checksumOf(document)}` : undefined;
      const examSections = itemKind === 'exam' ? rows(source?.sections).flatMap((sectionValue, index) => {
        const section = record(sectionValue);
        const sectionId = string(section?.id);
        if (!section || !sectionId) return [];
        return [{ sectionId, pointer: `/sections/${index}`, questionCount: questionCounts(section.questions).questionCount, timed: section.timeLimitMinutes !== undefined }];
      }) : undefined;
      return {
        itemId, kind: itemKind, title: item.title ?? source?.title,
        ...(itemHash ? { itemHash } : {}),
        ...(itemKind === 'lesson' ? { quizBlocks: quizBlocks(document), blockCount: rows(source?.blocks).length } : {}),
        ...(examSections ? { examSections } : {}),
      };
    }));
    return { moduleId, title: courseModule.title, items: items.filter((item): item is NonNullable<typeof item> => item !== null) };
  }));
  const resolvedModules = modules.filter((module): module is NonNullable<typeof module> => module !== null);
  const detailsOmitted = !selection.itemId && JSON.stringify(resolvedModules).length > 80_000;
  const outputModules = detailsOmitted
    ? resolvedModules.map(({ items, ...courseModule }) => ({
      ...courseModule,
      items: items.map(({ quizBlocks: _quizBlocks, examSections: _examSections, ...item }) => item),
    }))
    : resolvedModules;
  return {
    title: manifest?.title,
    ...courseLanguages(draft.manifest),
    draft: { updatedAt: draft.updatedAt, revision: draft.revision ?? '' },
    moduleTotal: allModules.length,
    nextModuleOffset: selection.itemId || selection.moduleId || offset + limit >= allModules.length ? null : offset + limit,
    detailsOmitted,
    modules: outputModules,
  };
}
