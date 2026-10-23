import { z } from 'zod';
import { AlignSchema, HttpsUrlSchema, IdSchema, L10nStringSchema, MediaRefSchema, l10n } from './common';
import { RunsSchema } from './inline';
import type { ContentBlock, RichContent } from './types';

export const CONTENT_BLOCK_TYPES = ['paragraph', 'heading', 'list', 'quote', 'image', 'video', 'audio', 'table', 'code', 'divider', 'embed', 'pdf', 'callout', 'math', 'diagram'] as const;
export type ContentBlockType = (typeof CONTENT_BLOCK_TYPES)[number];

export const VIDEO_PROVIDERS = ['youtube', 'vimeo'] as const;
export const VIDEO_PROVIDER_HOSTS: Record<(typeof VIDEO_PROVIDERS)[number], string[]> = {
  youtube: ['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'],
  vimeo: ['vimeo.com', 'player.vimeo.com'],
};
export const EMBED_HOSTS = ['docs.google.com', 'www.figma.com', 'figma.com', 'codesandbox.io', 'www.canva.com', 'canva.com', 'www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'];
/** Hosts allowed for media by URL (in addition to Supabase Storage, which is checked by suffix). */
export const MEDIA_HOSTS = ['cdn.vfuturelabs.org', 'images.unsplash.com', 'upload.wikimedia.org', 'commons.wikimedia.org'];
export const MEDIA_HOST_SUFFIXES = ['.supabase.co', '.supabase.in'];
export const CODE_BLOCK_LANGUAGES = ['python', 'javascript', 'typescript', 'tsx', 'jsx', 'html', 'css', 'json', 'sql', 'bash', 'markdown', 'yaml', 'plaintext', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'swift', 'kotlin', 'r'] as const;

export function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}
export const isAllowedEmbedHost = (url: string) => { const h = hostOf(url); return !!h && EMBED_HOSTS.includes(h); };
export const isAllowedMediaHost = (url: string) => { const h = hostOf(url); return !!h && (MEDIA_HOSTS.includes(h) || MEDIA_HOST_SUFFIXES.some((s) => h.endsWith(s))); };
export const isProviderUrl = (provider: (typeof VIDEO_PROVIDERS)[number], url: string) => { const h = hostOf(url); return !!h && VIDEO_PROVIDER_HOSTS[provider].includes(h); };

const idOpt = { id: IdSchema.optional() };
export const ListItemSchema: z.ZodType<{ content: z.infer<typeof RunsSchema>; items?: unknown[] }> = z.lazy(() =>
  z.object({ content: RunsSchema, items: z.array(ListItemSchema).max(50).optional() }).strict(),
);
const TableCellSchema = z.object({ content: RunsSchema, align: AlignSchema.optional() }).strict();

/** Build the content block schemas with a given schema for callout children. */
export function buildContentBlockSchemas<C extends z.ZodTypeAny>(children: C) {
  return {
    paragraph: z.object({ ...idOpt, type: z.literal('paragraph'), content: RunsSchema, align: AlignSchema.optional() }).strict(),
    heading: z.object({ ...idOpt, type: z.literal('heading'), level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), content: RunsSchema, align: AlignSchema.optional() }).strict(),
    list: z.object({ ...idOpt, type: z.literal('list'), ordered: z.boolean(), items: z.array(ListItemSchema).min(1).max(100) }).strict(),
    quote: z.object({ ...idOpt, type: z.literal('quote'), content: RunsSchema, author: L10nStringSchema.optional() }).strict(),
    image: z.object({ ...idOpt, type: z.literal('image'), src: MediaRefSchema, alt: L10nStringSchema, caption: L10nStringSchema.optional(), width: z.enum(['sm', 'md', 'full']).optional() }).strict(),
    video: z.union([
      z.object({ ...idOpt, type: z.literal('video'), src: MediaRefSchema, poster: MediaRefSchema.optional(), caption: L10nStringSchema.optional() }).strict(),
      z.object({ ...idOpt, type: z.literal('video'), provider: z.enum(VIDEO_PROVIDERS), url: HttpsUrlSchema, caption: L10nStringSchema.optional() }).strict()
        .refine((v) => isProviderUrl(v.provider, v.url), { message: 'url host does not match provider', path: ['url'] }),
    ]),
    audio: z.object({ ...idOpt, type: z.literal('audio'), src: MediaRefSchema, label: L10nStringSchema.optional() }).strict(),
    table: z.object({ ...idOpt, type: z.literal('table'), headers: z.array(TableCellSchema).min(1).max(12).optional(), rows: z.array(z.array(TableCellSchema).min(1).max(12)).min(1).max(100), caption: L10nStringSchema.optional() }).strict(),
    code: z.object({ ...idOpt, type: z.literal('code'), language: z.enum(CODE_BLOCK_LANGUAGES), code: z.string().max(20000), filename: z.string().max(120).optional(), highlightLines: z.array(z.number().int().min(1)).max(200).optional(), showLineNumbers: z.boolean().optional() }).strict(),
    divider: z.object({ ...idOpt, type: z.literal('divider') }).strict(),
    embed: z.object({ ...idOpt, type: z.literal('embed'), url: HttpsUrlSchema.refine(isAllowedEmbedHost, { message: 'embed host is not allowlisted' }), title: L10nStringSchema, aspectRatio: z.enum(['16:9', '4:3', '1:1']).optional() }).strict(),
    pdf: z.object({ ...idOpt, type: z.literal('pdf'), src: MediaRefSchema, title: L10nStringSchema, height: z.number().int().min(200).max(2000).optional() }).strict(),
    callout: z.object({ ...idOpt, type: z.literal('callout'), variant: z.enum(['info', 'tip', 'warning', 'danger', 'note']), title: L10nStringSchema.optional(), blocks: z.array(children).min(1).max(50) }).strict(),
    math: z.object({ ...idOpt, type: z.literal('math'), latex: z.string().max(2000) }).strict(),
    diagram: z.object({ ...idOpt, type: z.literal('diagram'), src: MediaRefSchema, alt: L10nStringSchema }).strict(),
  };
}

/** Content-only block union (question stems, explanations, resource bodies). Callout children are content blocks. */
export const ContentBlockSchema: z.ZodType<ContentBlock> = z.lazy(() => {
  const s = buildContentBlockSchemas(ContentBlockSchema);
  return z.union([s.paragraph, s.heading, s.list, s.quote, s.image, s.video, s.audio, s.table, s.code, s.divider, s.embed, s.pdf, s.callout, s.math, s.diagram]) as unknown as z.ZodType<ContentBlock>;
});

export const RichContentSchema: z.ZodType<RichContent> = z.object({ blocks: z.array(ContentBlockSchema).min(1).max(200) }).strict() as unknown as z.ZodType<RichContent>;
export const L10nRichContentSchema = l10n(RichContentSchema);
export type { ContentBlock, RichContent, L10nRichContent } from './types';
