import {
  isLocaleMap,
  L10nStringSchema,
  LocaleSchema,
  MediaRefSchema,
  type Locale,
} from "@/content-engine/schema/common";
import { PATHWAYS } from "@/content-engine/schema/course";

export const COURSE_LEVELS = ["foundation", "specialization"] as const;
export const COURSE_DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export const MAX_COURSE_TAGS = 20;
export const MAX_COURSE_TAG_LENGTH = 40;

export type LocalizedMetadataField = "title" | "summary";
export type MetadataField =
  | "languages"
  | "defaultLanguage"
  | "pathway"
  | "level"
  | "difficulty"
  | "estimatedMinutes"
  | "tags"
  | "cover";

type RecordValue = Record<string, unknown>;

export type TagsValidation =
  | { ok: true; tags: string[] }
  | { ok: false; reason: "too-many" | "too-long" };

function record(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function cloneRecord(document: unknown): RecordValue | null {
  const value = record(document);
  return value ? structuredClone(value) : null;
}

export function validateTags(value: unknown): TagsValidation {
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== "string")) {
    return { ok: false, reason: "too-long" };
  }
  if (value.length > MAX_COURSE_TAGS) return { ok: false, reason: "too-many" };
  if (value.some((tag) => tag.length < 1 || tag.length > MAX_COURSE_TAG_LENGTH)) {
    return { ok: false, reason: "too-long" };
  }
  return { ok: true, tags: value };
}

function validMetadataValue(field: MetadataField, value: unknown): boolean {
  switch (field) {
    case "languages":
      return Array.isArray(value)
        && value.length >= 1
        && value.length <= 2
        && value.every((locale) => LocaleSchema.safeParse(locale).success);
    case "defaultLanguage":
      return LocaleSchema.safeParse(value).success;
    case "pathway":
      return typeof value === "string" && (PATHWAYS as readonly string[]).includes(value);
    case "level":
      return typeof value === "string" && (COURSE_LEVELS as readonly string[]).includes(value);
    case "difficulty":
      return typeof value === "string" && (COURSE_DIFFICULTIES as readonly string[]).includes(value);
    case "estimatedMinutes":
      return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 1);
    case "tags":
      return validateTags(value).ok;
    case "cover":
      return value === undefined || MediaRefSchema.safeParse(value).success;
  }
}

/** Clone a document and replace one exposed scalar metadata field. */
export function setMetadata(document: unknown, field: MetadataField, value: unknown): unknown {
  if (!validMetadataValue(field, value)) return document;
  const next = cloneRecord(document);
  if (!next) return document;
  if (value === undefined) delete next[field];
  else next[field] = structuredClone(value);
  return next;
}

/**
 * Update one locale without changing the other locale or collapsing an existing
 * locale map. A scalar is kept when its default-language value is edited.
 */
export function setLocalizedMetadata(
  document: unknown,
  field: LocalizedMetadataField,
  locale: Locale,
  value: string,
  defaultLanguage: Locale,
): unknown {
  if (!LocaleSchema.safeParse(locale).success
    || !LocaleSchema.safeParse(defaultLanguage).success
    || !L10nStringSchema.safeParse(value).success) return document;

  const next = cloneRecord(document);
  if (!next) return document;
  const current = next[field];

  if (typeof current === "string" && locale === defaultLanguage) {
    next[field] = value;
    return next;
  }

  if (typeof current === "string") {
    if (!value && locale !== defaultLanguage) return document;
    next[field] = { [defaultLanguage]: current, [locale]: value };
    return next;
  }

  const localized: Partial<Record<Locale, string>> = isLocaleMap(current)
    ? { ...current } as Partial<Record<Locale, string>>
    : {};
  if (!value && locale !== defaultLanguage) delete localized[locale];
  else localized[locale] = value;
  next[field] = localized;
  return next;
}

export function setLearningOutcomeText(
  document: unknown,
  index: number,
  locale: Locale,
  value: string,
  defaultLanguage: Locale,
): unknown {
  const root = record(document);
  if (!root || !Array.isArray(root.learningOutcomes) || !Number.isInteger(index) || index < 0 || index >= root.learningOutcomes.length) return document;
  const holder = { title: root.learningOutcomes[index] };
  const updated = setLocalizedMetadata(holder, "title", locale, value, defaultLanguage) as RecordValue;
  if (updated === holder) return document;
  const next = cloneRecord(document)!;
  (next.learningOutcomes as unknown[])[index] = updated.title;
  return next;
}

export function addLearningOutcome(document: unknown, defaultLanguage: Locale): unknown {
  if (!LocaleSchema.safeParse(defaultLanguage).success) return document;
  const root = record(document);
  if (!root || !Array.isArray(root.learningOutcomes) || root.learningOutcomes.length >= 20) return document;
  const next = cloneRecord(document)!;
  (next.learningOutcomes as unknown[]).push({ [defaultLanguage]: "" });
  return next;
}

export function removeLearningOutcome(document: unknown, index: number): unknown {
  const root = record(document);
  if (!root || !Array.isArray(root.learningOutcomes) || root.learningOutcomes.length <= 1 || !Number.isInteger(index) || index < 0 || index >= root.learningOutcomes.length) return document;
  const next = cloneRecord(document)!;
  (next.learningOutcomes as unknown[]).splice(index, 1);
  return next;
}

export function localizedText(value: unknown, locale: Locale, defaultLanguage: Locale): string {
  if (typeof value === "string") return locale === defaultLanguage ? value : "";
  if (!isLocaleMap(value)) return "";
  const text = value[locale];
  return typeof text === "string" ? text : "";
}

export function hasDefaultLanguageTitle(document: unknown, defaultLanguage: Locale): boolean {
  const value = record(document)?.title;
  const text = localizedText(value, defaultLanguage, defaultLanguage);
  return L10nStringSchema.safeParse(value).success && text.trim().length > 0;
}
