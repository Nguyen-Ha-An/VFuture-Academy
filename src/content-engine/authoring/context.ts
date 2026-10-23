import type { CourseWorkspace } from '../validate/workspace';
import type { Locale } from '../schema/common';

export type AuthoringKind = 'lesson' | 'exam' | 'assignment';
export type LanguageMode = 'mono' | 'bilingual' | 'default-only';

/** Values that an edit may reuse from the current draft. Empty lists forbid the field. */
export interface ProfileContext {
  languageMode: LanguageMode;
  languages: Locale[];
  defaultLanguage: Locale;
  assetIds: string[];
  bankRefs: string[];
  skills: string[];
  tagWhitelist: string[];
  resourceIds: string[];
  opportunityIds: string[];
  itemTargets: { lesson: string[]; exam: string[] };
  existingItemIds: string[];
  knownUrls: string[];
  target?: { id: string; kind: AuthoringKind };
  /** Available only to per-course validation for synthetic storage checks. */
  sourceDraft?: CourseWorkspace;
}

export interface ProfileContextOptions {
  languagePolicy?: 'both' | 'default-only';
  target?: { id: string; kind: AuthoringKind };
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const isLocale = (value: unknown): value is Locale => value === 'vi' || value === 'en';

/** Static public schemas have no course identity and cannot introduce references. */
export function staticProfileContext(languageMode: 'mono' | 'bilingual'): ProfileContext {
  return {
    languageMode,
    languages: languageMode === 'mono' ? ['vi'] : ['vi', 'en'],
    defaultLanguage: 'vi',
    assetIds: [], bankRefs: [], skills: [], tagWhitelist: [],
    resourceIds: [], opportunityIds: [],
    itemTargets: { lesson: [], exam: [] },
    existingItemIds: [], knownUrls: [],
  };
}

/**
 * Collect references from the course's existing draft. This is deliberately a read
 * of existing values, never a lookup or an invitation to synthesize identifiers.
 */
export function profileContextFromDraft(draft: CourseWorkspace, options: ProfileContextOptions = {}): ProfileContext {
  const manifest = asRecord(draft.manifest) ?? {};
  const declared = Array.isArray(manifest.languages) ? manifest.languages.filter(isLocale) : [];
  const languages = sorted(declared) as Locale[];
  const normalizedLanguages: Locale[] = languages.length ? languages : ['vi'];
  const defaultLanguage = isLocale(manifest.defaultLanguage) && normalizedLanguages.includes(manifest.defaultLanguage)
    ? manifest.defaultLanguage : normalizedLanguages[0];

  const existingItemIds = new Set<string>();
  const itemTargets = { lesson: new Set<string>(), exam: new Set<string>() };
  for (const courseModule of Array.isArray(manifest.modules) ? manifest.modules : []) {
    const items = asRecord(courseModule)?.items;
    for (const entry of Array.isArray(items) ? items : []) {
      const item = asRecord(entry);
      if (typeof item?.id !== 'string') continue;
      existingItemIds.add(item.id);
      if (item.type === 'lesson' || item.type === 'exam') itemTargets[item.type].add(item.id);
    }
  }
  for (const id of Object.keys(draft.items)) existingItemIds.add(id);

  const assetIds = new Set<string>();
  const bankRefs = new Set<string>();
  const skills = new Set<string>();
  const tagWhitelist = new Set<string>();
  const resourceIds = new Set<string>();
  const opportunityIds = new Set<string>();
  const knownUrls = new Set<string>();

  for (const skill of Array.isArray(manifest.skills) ? manifest.skills : []) {
    const id = asRecord(skill)?.id;
    if (typeof id === 'string') skills.add(id);
  }
  for (const id of Array.isArray(manifest.relatedOpportunities) ? manifest.relatedOpportunities : []) {
    if (typeof id === 'string') opportunityIds.add(id);
  }

  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const row = value as Record<string, unknown>;
    if (typeof row.assetId === 'string') assetIds.add(row.assetId);
    if (typeof row.$ref === 'string' && row.$ref.startsWith('bank:')) bankRefs.add(row.$ref);
    if (typeof row.resourceId === 'string') resourceIds.add(row.resourceId);
    if (typeof row.opportunityId === 'string') opportunityIds.add(row.opportunityId);
    if (typeof row.url === 'string') knownUrls.add(row.url);
    if (typeof row.href === 'string') knownUrls.add(row.href);
    if (Array.isArray(row.tags)) row.tags.forEach((tag) => { if (typeof tag === 'string') tagWhitelist.add(tag); });
    const pool = asRecord(row.$pool);
    if (Array.isArray(pool?.from)) pool.from.forEach((ref) => { if (typeof ref === 'string' && ref.startsWith('bank:')) bankRefs.add(ref); });
    Object.values(row).forEach(visit);
  };
  visit(manifest);
  Object.values(draft.items).forEach(visit);

  return {
    languageMode: normalizedLanguages.length === 1 ? 'mono' : options.languagePolicy === 'default-only' ? 'default-only' : 'bilingual',
    languages: normalizedLanguages,
    defaultLanguage,
    assetIds: sorted(assetIds), bankRefs: sorted(bankRefs), skills: sorted(skills),
    tagWhitelist: sorted(tagWhitelist), resourceIds: sorted(resourceIds), opportunityIds: sorted(opportunityIds),
    itemTargets: { lesson: sorted(itemTargets.lesson), exam: sorted(itemTargets.exam) },
    existingItemIds: sorted(existingItemIds), knownUrls: sorted(knownUrls),
    ...(options.target ? { target: options.target } : {}),
    sourceDraft: draft,
  };
}
