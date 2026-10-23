import { COURSE_REF, itemRef, makeDiagnostic, toRef, type Diagnostic, type DocumentRef } from '../../diagnostics';
import { hostOf, isAllowedMediaHost } from '../../schema/rich-content';
import type { ParsedWorkspace } from '../workspace';

/** Every { url } media reference (image/video/audio/pdf/cover/attachments) with its path. Provider videos and embeds are excluded (they carry `provider` / are `embed` blocks). */
export function collectMediaUrls(value: unknown, path = '', parentType?: string): { url: string; path: string }[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => collectMediaUrls(v, `${path}/${i}`, parentType));
  if (typeof value !== 'object' || value === null) return [];
  const o = value as Record<string, unknown>;
  if (typeof o.url === 'string' && Object.keys(o).length === 1 && parentType !== 'embed') return [{ url: o.url, path: `${path}/url` }];
  const type = typeof o.type === 'string' ? o.type : parentType;
  return Object.entries(o).flatMap(([k, v]) => (k === 'settings' || k === 'correctAnswer' ? [] : collectMediaUrls(v, `${path}/${k}`, type)));
}

export function checkHosts(parsed: ParsedWorkspace): Diagnostic[] {
  const out: Diagnostic[] = [];
  out.push(...checkMediaHosts(COURSE_REF, parsed.manifest));
  for (const [docId, doc] of Object.entries(parsed.items)) out.push(...checkMediaHosts(itemRef(docId), doc));
  return out;
}

/** Apply the media URL policy to any structurally valid content document. */
export function checkMediaHosts(doc: string | DocumentRef, document: unknown): Diagnostic[] {
  const ref = toRef(doc);
  const out: Diagnostic[] = [];
  for (const { url, path } of collectMediaUrls(document)) {
    out.push(makeDiagnostic('W_EXTERNAL_MEDIA', { ref, path }));
    if (!isAllowedMediaHost(url)) out.push(makeDiagnostic('E_MEDIA_HOST_NOT_ALLOWED', { ref, path, meta: { host: hostOf(url) ?? url } }));
  }
  return out;
}
