export interface TextNormalizeOptions { caseSensitive?: boolean; ignoreAccents?: boolean }

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

export function normalizeText(s: string, o: TextNormalizeOptions = {}): string {
  let t = s.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!o.caseSensitive) t = t.toLowerCase();
  if (o.ignoreAccents) t = stripAccents(t);
  return t;
}

/** Parse learner numeric input. Vietnamese learners commonly type "3,14"; both separators are accepted. */
export function parseNumber(input: unknown, o: { decimalComma?: boolean } = {}): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/\s+/g, '');
  if (!s) return null;
  const decimalComma = o.decimalComma ?? true;
  const dots = (s.match(/\./g) ?? []).length, commas = (s.match(/,/g) ?? []).length;
  if (dots > 0 && commas > 0) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (commas > 1) {
    s = s.replace(/,/g, '');
  } else if (commas === 1) {
    s = decimalComma ? s.replace(',', '.') : s.replace(',', '');
  } else if (dots > 1 && /^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // Vietnamese thousands grouping: 1.234.567
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export const wordCount = (s: string) => s.trim() ? s.trim().split(/\s+/).length : 0;
