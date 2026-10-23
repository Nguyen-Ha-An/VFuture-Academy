import 'server-only';

import type { L10nString, Locale } from '@/content-engine/schema/common';
import { supabaseService } from '@/lib/supabase/server';

/** Localizable title exactly as the compiled outline stores it: a string or a { vi?, en? } map. */
export type OutlineTitle = L10nString;

export type VersionTitles = {
  courseId: string;
  /** `meta.title`, or the course id when the outline has none. */
  courseTitle: OutlineTitle;
  /** Lesson, exam and assignment titles from `outline.modules[].items[]`, by item id. */
  items: Map<string, OutlineTitle>;
};

type OutlineQueryResult = { data: unknown; error: unknown };
type OutlineDatabase = {
  from(table: 'course_version_outline'): {
    select(columns: string): {
      in(column: string, values: string[]): PromiseLike<OutlineQueryResult>;
    };
  };
};

export const VERSION_TITLE_BATCH_SIZE = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Keeps a string or a { vi, en } map with at least one non-empty entry; anything else is dropped. */
function outlineTitle(value: unknown): OutlineTitle | null {
  const text = nonEmpty(value);
  if (text) return text;
  const map = record(value);
  if (!map) return null;
  const vi = nonEmpty(map.vi);
  const en = nonEmpty(map.en);
  if (!vi && !en) return null;
  return { ...(vi ? { vi } : {}), ...(en ? { en } : {}) };
}

function itemTitles(outline: unknown): Map<string, OutlineTitle> {
  const items = new Map<string, OutlineTitle>();
  const modules = record(outline)?.modules;
  if (!Array.isArray(modules)) return items;
  for (const rawModule of modules) {
    const moduleItems = record(rawModule)?.items;
    if (!Array.isArray(moduleItems)) continue;
    for (const rawItem of moduleItems) {
      const item = record(rawItem);
      const id = nonEmpty(item?.id);
      const title = outlineTitle(item?.title);
      if (id && title && !items.has(id)) items.set(id, title);
    }
  }
  return items;
}

function parseRow(value: unknown): [string, VersionTitles] | null {
  const row = record(value);
  const versionId = nonEmpty(row?.version_id);
  const courseId = nonEmpty(row?.course_id);
  if (!row || !versionId || !courseId) return null;
  return [versionId.toLowerCase(), {
    courseId,
    courseTitle: outlineTitle(record(row.meta)?.title) ?? courseId,
    items: itemTitles(row.outline),
  }];
}

/**
 * Course and item titles for the given course versions, from `course_version_outline`, keyed by
 * lower-cased version id. Never throws: a failed batch leaves its versions out and callers fall
 * back to ids through `resolveItemTitle`/`resolveCourseTitle`.
 */
export async function versionTitles(
  versionIds: Iterable<string | null | undefined>,
  database?: OutlineDatabase,
): Promise<Map<string, VersionTitles>> {
  const titles = new Map<string, VersionTitles>();
  const wanted = [...new Set([...versionIds].flatMap((id) => {
    const trimmed = typeof id === 'string' ? id.trim() : '';
    return UUID.test(trimmed) ? [trimmed.toLowerCase()] : [];
  }))];
  if (wanted.length === 0) return titles;
  let client: OutlineDatabase;
  try {
    client = database ?? supabaseService() as unknown as OutlineDatabase;
  } catch {
    return titles;
  }
  const batches: string[][] = [];
  for (let index = 0; index < wanted.length; index += VERSION_TITLE_BATCH_SIZE) {
    batches.push(wanted.slice(index, index + VERSION_TITLE_BATCH_SIZE));
  }
  const pages = await Promise.all(batches.map(async (batch) => {
    try {
      const { data, error } = await client
        .from('course_version_outline')
        .select('version_id,course_id,meta,outline')
        .in('version_id', batch);
      return error || !Array.isArray(data) ? [] : data;
    } catch {
      return [];
    }
  }));
  for (const row of pages.flat()) {
    const entry = parseRow(row);
    if (entry) titles.set(entry[0], entry[1]);
  }
  return titles;
}

/** Picks the requested locale, then the other locale; null when the title has neither. */
export function localizeOutlineTitle(title: OutlineTitle | null | undefined, locale: Locale): string | null {
  if (title === null || title === undefined) return null;
  if (typeof title === 'string') return nonEmpty(title);
  const other: Locale = locale === 'vi' ? 'en' : 'vi';
  return nonEmpty(title[locale]) ?? nonEmpty(title[other]);
}

/** The item's title in `locale`, falling back to the other locale, then to the item id. */
export function resolveItemTitle(
  map: ReadonlyMap<string, VersionTitles>,
  versionId: string | null | undefined,
  itemId: string,
  locale: Locale,
): string {
  const version = versionId ? map.get(versionId.toLowerCase()) : undefined;
  return localizeOutlineTitle(version?.items.get(itemId), locale) ?? itemId;
}

/** The course title in `locale`, falling back to the other locale, then to `fallback` (e.g. the course id). */
export function resolveCourseTitle(
  map: ReadonlyMap<string, VersionTitles>,
  versionId: string | null | undefined,
  locale: Locale,
  fallback: string,
): string {
  const version = versionId ? map.get(versionId.toLowerCase()) : undefined;
  return localizeOutlineTitle(version?.courseTitle, locale) ?? fallback;
}
