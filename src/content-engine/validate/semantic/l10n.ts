import { COURSE_REF, itemRef, makeDiagnostic, type Diagnostic, type DocumentRef } from '../../diagnostics';
import { isLocaleMap, type Locale } from '../../schema/common';
import { NON_LOCALIZED_KEYS } from '../../compile/localize';
import type { ParsedWorkspace } from '../workspace';

function walkLocaleMaps(value: unknown, path: string, visit: (map: Record<string, unknown>, path: string) => void): void {
  if (Array.isArray(value)) { value.forEach((v, i) => walkLocaleMaps(v, `${path}/${i}`, visit)); return; }
  if (typeof value !== 'object' || value === null) return;
  if (isLocaleMap(value)) { visit(value as Record<string, unknown>, path); Object.entries(value).forEach(([k, v]) => walkLocaleMaps(v, `${path}/${k}`, visit)); return; }
  for (const [k, v] of Object.entries(value)) if (!NON_LOCALIZED_KEYS.has(k)) walkLocaleMaps(v, `${path}/${k}`, visit);
}

export function checkL10n(parsed: ParsedWorkspace): Diagnostic[] {
  const out: Diagnostic[] = [];
  const { languages, defaultLanguage } = parsed.manifest;
  const check = (ref: DocumentRef, doc: unknown) => walkLocaleMaps(doc, '', (map, path) => {
    for (const k of Object.keys(map)) if (!languages.includes(k as Locale)) out.push(makeDiagnostic('E_L10N_UNKNOWN_LOCALE', { ref, path: `${path}/${k}`, meta: { locale: k } }));
    if (!(defaultLanguage in map)) out.push(makeDiagnostic('E_L10N_MISSING_DEFAULT', { ref, path, meta: { locale: defaultLanguage } }));
    for (const l of languages) if (l !== defaultLanguage && !(l in map)) out.push(makeDiagnostic('W_L10N_MISSING_TRANSLATION', { ref, path, meta: { locale: l } })); // the default is already an error above
  });
  check(COURSE_REF, parsed.manifest);
  for (const [docId, doc] of Object.entries(parsed.items)) {
    const ref = itemRef(docId);
    const d = doc as { languages?: string[]; defaultLanguage?: string };
    if ((d.languages && d.languages.join() !== languages.join()) || (d.defaultLanguage && d.defaultLanguage !== defaultLanguage)) out.push(makeDiagnostic('W_L10N_LANGUAGE_OVERRIDE', { ref, path: '/languages' }));
    check(ref, doc);
  }
  return out;
}
