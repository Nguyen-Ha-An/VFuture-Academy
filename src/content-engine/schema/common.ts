import { z } from 'zod';

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const IdSchema = z.string().regex(ID_PATTERN, 'id must be kebab-case: a-z, 0-9, "-", max 64 chars');
export type Id = z.infer<typeof IdSchema>;

export const LOCALES = ['vi', 'en'] as const;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;

export const CURRENT_SCHEMA_VERSION = 1 as const;
export const DOCUMENT_KINDS = ['course', 'lesson', 'exam', 'assignment', 'question_bundle', 'resource'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Wrap a schema so a value may be either the inner value or a { vi?, en? } map of inner values (at least one key). */
export function l10n<T extends z.ZodTypeAny>(inner: T) {
  return z.union([
    inner,
    z.object({ vi: inner.optional(), en: inner.optional() }).strict().refine((m) => m.vi !== undefined || m.en !== undefined, { message: 'locale map needs at least one of vi, en' }),
  ]);
}

export const L10nStringSchema = l10n(z.string().max(2000));
export type L10nString = z.infer<typeof L10nStringSchema>;

export const HttpsUrlSchema = z.url().refine((u) => u.startsWith('https://'), { message: 'url must use https' });

export const MediaRefSchema = z.union([
  z.object({ assetId: z.string().min(1).max(80) }).strict(),
  z.object({ url: HttpsUrlSchema }).strict(),
]);
export type MediaRef = z.infer<typeof MediaRefSchema>;

export const AlignSchema = z.enum(['left', 'center', 'right', 'justify']);

export function envelopeFields<K extends DocumentKind>(kind: K) {
  return {
    $schema: z.string().optional(),
    schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
    kind: z.literal(kind),
    id: IdSchema,
  };
}

export function isLocaleMap(value: unknown): value is Partial<Record<Locale, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => (LOCALES as readonly string[]).includes(k));
}
