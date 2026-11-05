import type { Locale } from '@/content-engine';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Readable text from the already localized historical render, without any activity runtime. */
export function historyText(value: unknown, locale: Locale): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((entry) => historyText(entry, locale)).filter(Boolean).join(' ');
  const row = record(value);
  if (!row) return '';
  for (const language of [...new Set([locale, 'vi', 'en'])]) {
    if (row[language] !== undefined) return historyText(row[language], locale);
  }
  if (typeof row.text === 'string') return row.text;
  if (typeof row.blank === 'string') return '____';
  if (typeof row.latex === 'string') return row.latex;
  for (const field of ['content', 'blocks', 'items', 'stem', 'label', 'title']) {
    if (row[field] !== undefined) return historyText(row[field], locale);
  }
  return '';
}

export function recordedTime(value: string, locale: Locale): string {
  return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(value)) : '—';
}

export function answerLabels(value: unknown, locale: Locale, labels = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) { value.forEach((child) => answerLabels(child, locale, labels)); return labels; }
  const row = record(value);
  if (!row) return labels;
  if (typeof row.id === 'string') {
    const label = historyText(row.content ?? row.label ?? row.stem, locale);
    if (label) labels.set(row.id, label);
  }
  for (const field of ['options', 'left', 'right', 'items', 'categories', 'questions', 'blanks']) answerLabels(row[field], locale, labels);
  return labels;
}

/** Saved answer values are displayed only; no check, submit, upload or draft hooks exist. */
export function RecordedAnswer({ value, locale, labels = new Map() }: { value: unknown; locale: Locale; labels?: Map<string, string> }) {
  if (value === null || value === undefined || value === '') return <p>{locale === 'vi' ? 'Không có câu trả lời đã lưu.' : 'No saved answer.'}</p>;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return <p className="whitespace-pre-wrap break-words">{labels.get(String(value)) ?? String(value)}</p>;
  if (Array.isArray(value)) return <ol className="list-inside list-decimal space-y-2">{value.map((entry, index) => <li key={index}><RecordedAnswer value={entry} locale={locale} labels={labels} /></li>)}</ol>;
  const row = record(value);
  if (!row) return null;
  if (typeof row.assetId === 'string') return <a className="underline" href={`/api/v1/media/${encodeURIComponent(row.assetId)}`}>{typeof row.name === 'string' ? row.name : locale === 'vi' ? 'Tệp đã nộp' : 'Submitted file'}</a>;
  if (typeof row.url === 'string' && /^https:\/\//i.test(row.url)) return <a className="break-all underline" href={row.url} target="_blank" rel="noopener noreferrer">{typeof row.label === 'string' ? row.label : row.url}</a>;
  if (typeof row.code === 'string') return <pre className="overflow-x-auto whitespace-pre-wrap"><code>{row.code}</code></pre>;
  return <dl className="space-y-2">{Object.entries(row).map(([key, entry]) => <div key={key}><dt className="font-medium">{labels.get(key) ?? key}</dt><dd><RecordedAnswer value={entry} locale={locale} labels={labels} /></dd></div>)}</dl>;
}
