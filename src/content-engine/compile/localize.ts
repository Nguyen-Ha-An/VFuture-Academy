import { isLocaleMap, type L10nString, type Locale } from '../schema/common';

/** Keys whose subtrees are never locale maps (answer keys, machine settings). */
export const NON_LOCALIZED_KEYS = new Set(['correctAnswer', 'settings', 'display', '$pool', 'filter', 'accepts', 'allowedMimeTypes', 'linkHosts', 'tags', 'skills']);

export function resolveL10nString(value: L10nString, locale: Locale, defaultLocale: Locale): string {
  if (typeof value === 'string') return value;
  const picked = value[locale] ?? value[defaultLocale] ?? Object.values(value).find((v) => typeof v === 'string');
  return picked ?? '';
}

function pick<T>(map: Partial<Record<Locale, T>>, locale: Locale, defaultLocale: Locale): T | undefined {
  return map[locale] ?? map[defaultLocale] ?? Object.values(map).find((v) => v !== undefined);
}

/** Deep-copy `value`, replacing every locale map (outside NON_LOCALIZED_KEYS) with the value for `locale`. */
export function localizeDeep(value: unknown, locale: Locale, defaultLocale: Locale): unknown {
  if (Array.isArray(value)) return value.map((v) => localizeDeep(v, locale, defaultLocale));
  if (typeof value !== 'object' || value === null) return value;
  if (isLocaleMap(value)) return localizeDeep(pick(value, locale, defaultLocale), locale, defaultLocale);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = NON_LOCALIZED_KEYS.has(k) ? structuredClone(v) : localizeDeep(v, locale, defaultLocale);
  }
  return out;
}
