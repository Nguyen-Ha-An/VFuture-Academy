import type { L10nString } from '../schema/common';
import type { L10nRichContent, RichContent } from '../schema/types';
import { isLocaleMap } from '../schema/common';

/** Learner payloads are localized before rendering; these helpers only defend against stray maps. */
export function asText(v: L10nString | undefined | null): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  return Object.values(v).find((x) => typeof x === 'string') ?? '';
}
export function asRich(v: L10nRichContent | undefined | null): RichContent {
  if (!v) return { blocks: [] };
  if (isLocaleMap(v)) return (Object.values(v).find(Boolean) as RichContent) ?? { blocks: [] };
  return v as RichContent;
}
