/** Vietnam observes UTC+07:00 year-round. Do not use the browser's time zone. */
export function deadlineToLocal(utc: string | null): string {
  if (!utc) return '';
  const timestamp = Date.parse(utc);
  return Number.isFinite(timestamp) ? new Date(timestamp + 7 * 3600000).toISOString().slice(0, 16) : '';
}

export function deadlineToUtc(local: string): string | null {
  return local ? new Date(`${local}:00+07:00`).toISOString() : null;
}
