import type { Locale } from '@/content-engine/schema/common';

/** Saved status is rendered in the same school timezone on server and browser. */
export function workspaceSavedTime(value: number, locale: Locale): string {
  if (!Number.isFinite(value) || Number.isNaN(new Date(value).getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(value);
}
