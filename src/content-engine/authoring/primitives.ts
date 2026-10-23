import { z } from 'zod';
import { AlignSchema, IdSchema, MediaRefSchema } from '../schema/common';
import { AnnotationsSchema, BlankRunSchema, TextRunSchema } from '../schema/inline';
import { EMBED_HOSTS, MEDIA_HOSTS, MEDIA_HOST_SUFFIXES, VIDEO_PROVIDER_HOSTS } from '../schema/rich-content';
import type { ProfileContext } from './context';
import type { Policy } from './ledger';

export const PRIMITIVE_FIELD_POLICY = {
  annotations: {
    bold: 'reuse', italic: 'reuse', underline: 'reuse', strike: 'reuse',
    code: 'reuse', sub: 'reuse', sup: 'reuse', color: 'forbid', link: 'reuse',
  } satisfies Record<keyof typeof AnnotationsSchema.shape, Policy>,
  textRun: { text: 'tighten', annotations: 'tighten' } satisfies Record<keyof typeof TextRunSchema.shape, Policy>,
  blankRun: { blank: 'reuse', size: 'reuse' } satisfies Record<keyof typeof BlankRunSchema.shape, Policy>,
  mediaByAsset: { assetId: 'context' } satisfies Record<keyof typeof MediaRefSchema.options[0]['shape'], Policy>,
  mediaByUrl: { url: 'tighten' } satisfies Record<keyof typeof MediaRefSchema.options[1]['shape'], Policy>,
} as const;

/** A profile label is a storage string with meaningful visible content. */
export const LabelSchema = z.string().min(1).max(2000).regex(/\S/);
export const TextValueSchema = z.string().min(1).max(5000);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A host expression intentionally allows paths, but never credentials, ports, or a new host. */
export function httpsHostPattern(hosts: readonly string[]): RegExp {
  return new RegExp(`^https://(?:${hosts.map(escapeRegExp).join('|')})(?:/[^\\s]*)?$`);
}

export const MEDIA_URL_PATTERN = new RegExp(
  `^https://(?:${MEDIA_HOSTS.map(escapeRegExp).join('|')}|[a-z0-9-]+(?:\\.[a-z0-9-]+)*(?:${MEDIA_HOST_SUFFIXES.map(escapeRegExp).join('|')}))(?:/[^\\s]*)?$`,
);
export const EMBED_URL_PATTERN = httpsHostPattern(EMBED_HOSTS);
export const VIDEO_URL_PATTERN = httpsHostPattern(Object.values(VIDEO_PROVIDER_HOSTS).flat());
export const VIDEO_PROVIDER_URL_PATTERNS = {
  youtube: httpsHostPattern(VIDEO_PROVIDER_HOSTS.youtube),
  vimeo: httpsHostPattern(VIDEO_PROVIDER_HOSTS.vimeo),
} as const;

/** URL validation stays expressible in both Zod and emitted JSON Schema. */
export const MediaUrlSchema = z.string().url().regex(MEDIA_URL_PATTERN);
export const EmbedUrlSchema = z.string().url().regex(EMBED_URL_PATTERN);
export const VideoUrlSchema = z.string().url().regex(VIDEO_URL_PATTERN);

export function localize<T extends z.ZodType>(inner: T, languageMode: ProfileContext['languageMode']) {
  return languageMode === 'bilingual'
    ? z.strictObject({ vi: inner, en: inner })
    : inner;
}

export function buildAuthoringPrimitives(ctx: ProfileContext) {
  const link = AnnotationsSchema.shape.link.unwrap();
  const annotations = z.strictObject({
    bold: AnnotationsSchema.shape.bold,
    italic: AnnotationsSchema.shape.italic,
    underline: AnnotationsSchema.shape.underline,
    strike: AnnotationsSchema.shape.strike,
    code: AnnotationsSchema.shape.code,
    sub: AnnotationsSchema.shape.sub,
    sup: AnnotationsSchema.shape.sup,
    link: z.strictObject({ href: link.shape.href, target: link.shape.target }).optional(),
  });
  const textRun = z.strictObject({
    text: TextValueSchema,
    annotations: annotations.optional(),
  });
  const localizedTextRun = z.strictObject({
    text: localize(TextValueSchema, ctx.languageMode),
    annotations: annotations.optional(),
  });
  const blankRun = z.strictObject({
    blank: BlankRunSchema.shape.blank,
    size: BlankRunSchema.shape.size,
  });
  const runs = z.array(textRun).min(1).max(500);
  const localizedRuns = z.array(localizedTextRun).min(1).max(500);
  const fillBlankRuns = z.array(z.xor([textRun, blankRun])).min(1).max(500);

  const urlRef = z.strictObject({ url: MediaUrlSchema });
  const assetIds = [...new Set(ctx.assetIds.filter((id) => id.length > 0 && id.length <= 80))];
  const mediaRef = assetIds.length > 0
    ? z.xor([urlRef, z.strictObject({ assetId: z.enum(assetIds) })])
    : urlRef;

  return {
    id: IdSchema,
    align: AlignSchema,
    label: LabelSchema,
    l10nLabel: localize(LabelSchema, ctx.languageMode),
    textValue: TextValueSchema,
    l10nTextValue: localize(TextValueSchema, ctx.languageMode),
    annotations,
    textRun,
    localizedTextRun,
    blankRun,
    runs,
    localizedRuns,
    fillBlankRuns,
    mediaUrl: MediaUrlSchema,
    embedUrl: EmbedUrlSchema,
    videoUrl: VideoUrlSchema,
    mediaRef,
  };
}
