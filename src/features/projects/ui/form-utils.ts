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

const OUTPUT_ROW_PREFIX = '@vf-output-v1:';
const MEMBER_ROW_PREFIX = '@vf-member-v1:';

function decodedRow(value: string, prefix: string, size: number): string[] | null {
  const encoded = value.trim();
  if (!encoded.startsWith(prefix)) return null;
  try {
    const row: unknown = JSON.parse(encoded.slice(prefix.length));
    return Array.isArray(row) && row.length === size && row.every(part => typeof part === 'string') ? row : null;
  } catch { return null; }
}

/** Versioned local form rows preserve literal pipes, backslashes and newlines. */
export function serializeOutputLinkFields(fields: readonly [string, string, string]): string {
  return OUTPUT_ROW_PREFIX + JSON.stringify(fields);
}
export function serializeMemberFields(fields: readonly [string, string]): string {
  return MEMBER_ROW_PREFIX + JSON.stringify(fields);
}

/** Legacy recovery supports bare URLs, shared labels, and explicit bilingual columns. */
export function outputLinkFields(row: string): [string, string, string] {
  const decoded = decodedRow(row, OUTPUT_ROW_PREFIX, 3);
  if (decoded) return [decoded[0]!, decoded[1]!, decoded[2]!];
  const parts = row.split('|');
  let urlIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (/^https:\/\//i.test(parts[index]!.trim())) { urlIndex = index; break; }
  }
  if (urlIndex === -1) urlIndex = parts.length - 1;
  const labels = parts.slice(0, urlIndex);
  return [labels[0] ?? '', labels.length === 1 ? labels[0]! : labels[1] ?? '', parts[urlIndex] ?? ''];
}

export function memberFields(row: string): [string, string] {
  const decoded = decodedRow(row, MEMBER_ROW_PREFIX, 2);
  if (decoded) return [decoded[0]!, decoded[1]!];
  const [id = '', role = 'member'] = row.split('|');
  return [id, role];
}

export function parseOutputLinks(value: string) {
  return value.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [vi, en, rawUrl] = outputLinkFields(line);
    const url = rawUrl.trim();
    if (!vi.trim() && !en.trim()) {
      const host = urlHostname(url);
      return { label: { vi: host, en: host }, url };
    }
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
    const [rawId, roleValue] = memberFields(line);
    const userId = rawId.trim();
    const rawRole = roleValue.trim();
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
