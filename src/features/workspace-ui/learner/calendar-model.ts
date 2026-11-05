/** Month boundaries and cells are computed in Vietnam's fixed UTC+7 timezone. */
export function calendarMonth(value?: string, now = new Date()) {
  const current = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const fallback = `${current.find(part => part.type === 'year')?.value}-${current.find(part => part.type === 'month')?.value}`;
  const key = value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100 ? value : fallback;
  const [year, month] = key.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  const shifted = (delta: number) => new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
  return {
    key, year, month, first, previous: shifted(-1), next: shifted(1),
    start: new Date(Date.UTC(year, month - 1, 1, -7)).toISOString(),
    end: new Date(Date.UTC(year, month, 1, -7)).toISOString(),
    cells: Array.from({ length: Math.ceil((offset + length) / 7) * 7 }, (_, index) => {
      const day = index - offset + 1;
      return day >= 1 && day <= length ? `${key}-${String(day).padStart(2, '0')}` : null;
    }),
  };
}
export function ictDay(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) : '';
}
