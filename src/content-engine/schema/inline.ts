import { z } from 'zod';
import { IdSchema, l10n, type Locale } from './common';

export const AnnotationsSchema = z.object({
  bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strike: z.boolean().optional(),
  code: z.boolean().optional(), sub: z.boolean().optional(), sup: z.boolean().optional(),
  color: z.string().regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,24})$/, 'color must be a hex or named CSS color').optional(),
  link: z.object({ href: z.string().regex(/^(https:\/\/|mailto:)\S+$/, 'link must be https or mailto'), target: z.literal('_blank').optional() }).strict().optional(),
}).strict();
export type Annotations = z.infer<typeof AnnotationsSchema>;

export const TextRunSchema = z.object({ text: l10n(z.string().max(5000)), annotations: AnnotationsSchema.optional() }).strict();
export const BlankRunSchema = z.object({ blank: IdSchema, size: z.enum(['sm', 'md', 'lg']).optional() }).strict();
export const RunSchema = z.union([TextRunSchema, BlankRunSchema]);
export const RunsSchema = z.array(RunSchema).min(1).max(500);

export type TextRun = z.infer<typeof TextRunSchema>;
export type BlankRun = z.infer<typeof BlankRunSchema>;
export type Run = z.infer<typeof RunSchema>;

export const isBlankRun = (r: Run): r is BlankRun => 'blank' in r;
/** A run's text may be localized; the requested locale wins, otherwise the first string in the map. */
const runText = (t: TextRun['text'], locale?: Locale): string => {
  if (typeof t === 'string') return t;
  const wanted = locale ? t[locale] : undefined;
  return wanted ?? Object.values(t).find((v) => typeof v === 'string') ?? '';
};
export const runsToPlainText = (runs: Run[], locale?: Locale): string => runs.map((r) => (isBlankRun(r) ? '____' : runText(r.text, locale))).join('');
