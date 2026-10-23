import type { L10nString } from '@/content-engine/schema/common';

export function localizedPart(value: L10nString | undefined, locale: 'vi' | 'en'): string {
  if (typeof value === 'string') return value;
  return value?.[locale] ?? '';
}

export function splitIds(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean))];
}

/** The URL's hostname without `www.`, or '' when it does not parse. */
export function urlHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Parses "Vietnamese label | English label | https://…" lines. The last
 * `https://` part is the URL, so "Demo | https://x.dev" works. A single label
 * serves both locales; an explicitly empty label ("Demo |  | https://…") is
 * omitted so one-language links round-trip. A bare URL with no label is
 * labelled with its hostname in both locales.
 */
export function parseOutputLinks(value: string) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split('|').map((part) => part.trim());
    let urlIndex = -1;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (/^https:\/\//i.test(parts[index])) { urlIndex = index; break; }
    }
    if (urlIndex === -1) urlIndex = parts.length - 1;
    const url = parts[urlIndex] ?? '';
    const labels = parts.slice(0, urlIndex);
    const [vi = '', en = ''] = labels;
    if (!labels.some(Boolean)) {
      const host = urlHostname(url);
      return { label: { vi: host, en: host }, url };
    }
    if (labels.length < 2) return { label: { vi, en: vi }, url };
    return { label: compactL10n({ vi, en }), url };
  });
}

/** Drops empty locale entries, e.g. `{ vi: 'A', en: '' }` becomes `{ vi: 'A' }`. */
export function compactL10n(value: { vi?: string; en?: string }): { vi?: string; en?: string } {
  const result: { vi?: string; en?: string } = {};
  const vi = value.vi?.trim();
  const en = value.en?.trim();
  if (vi) result.vi = vi;
  if (en) result.en = en;
  return result;
}

export function parseMembers(value: string) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [userId = '', rawRole = 'member'] = line.split('|').map((part) => part.trim());
    const role = rawRole === 'owner' || rawRole === 'mentor' ? rawRole : 'member';
    return { userId, role };
  });
}

export async function apiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}
