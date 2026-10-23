import type { Locale } from '../schema/common';

/*
 * Engine-local UI copy. The engine cannot import next-intl (tests/content-engine/boundary.test.ts),
 * so renderers read their chrome strings from this catalog by `runtime.locale`. Plural entries
 * use `#` for the count and go through `plural()`; `{name}` placeholders go through `tr()`.
 */

type Entry = Record<Locale, string>;
type PluralEntry = Record<Locale, { one: string; other: string }>;

export const engineStrings = {
  tabs: {
    label: { vi: 'Thẻ nội dung', en: 'Content tabs' },
    group: { vi: 'Các câu hỏi trong nhóm', en: 'Questions in this group' },
  },
  quiz: {
    questions: { vi: { one: '# câu hỏi', other: '# câu hỏi' }, en: { one: '# question', other: '# questions' } },
    graded: { vi: 'tính điểm', en: 'graded' },
    passMark: { vi: 'đạt ≥ {percent}%', en: 'pass ≥ {percent}%' },
    attemptsLeft: { vi: { one: '# lần còn lại', other: '# lần còn lại' }, en: { one: '# attempt left', other: '# attempts left' } },
  },
  video: {
    invalid: { vi: 'Đường dẫn video không hợp lệ.', en: 'This video link is not valid.' },
  },
  embed: {
    blocked: { vi: 'Không thể hiển thị nội dung nhúng từ trang này.', en: 'Embedded content from this site cannot be shown.' },
  },
  ordering: {
    dragHandle: { vi: 'Kéo để sắp xếp', en: 'Drag to reorder' },
    moveUp: { vi: 'Chuyển lên', en: 'Move up' },
    moveDown: { vi: 'Chuyển xuống', en: 'Move down' },
  },
  answer: {
    correct: { vi: 'Đáp án đúng', en: 'Correct answer' },
  },
  block: {
    unavailable: { vi: 'Phần này của bài học chưa thể hiển thị ở đây. Bạn vẫn có thể tiếp tục với phần còn lại.', en: 'This part of the lesson cannot be shown here yet. You can continue with the rest.' },
  },
} satisfies Record<string, Record<string, Entry | PluralEntry>>;

/** Picks the entry for the locale (falling back to English) and fills `{name}` placeholders. */
export function tr(locale: Locale, entry: Entry, vars?: Record<string, string | number>): string {
  const text = entry[locale] ?? entry.en;
  return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
}

/** Selects the CLDR plural form for `n` and substitutes `#` with the count. */
export function plural(locale: Locale, n: number, forms: { one: string; other: string }): string {
  const form = new Intl.PluralRules(locale).select(n) === 'one' ? forms.one : forms.other;
  return form.replaceAll('#', String(n));
}
