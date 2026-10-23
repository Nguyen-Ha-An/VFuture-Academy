/** Vietnam calendar day (YYYY-MM-DD) for an instant; mirrors activityDateInVietnam in xp/service. */
export function vietnamDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export type DeltaTone = 'up' | 'down' | 'flat' | 'new';

/** A delta with no baseline renders `new`, never ∞ or NaN (spec 4.12). */
export function formatDelta(current: number, previous: number | null | undefined, { percent = false } = {}): { text: string; tone: DeltaTone } {
  if (previous === null || previous === undefined || !Number.isFinite(previous) || previous === 0) return current > 0 ? { text: 'new', tone: 'new' } : { text: '·', tone: 'flat' };
  const diff = percent ? Math.round(((current - previous) / Math.abs(previous)) * 100) : current - previous;
  if (diff === 0) return { text: '·', tone: 'flat' };
  return { text: `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}${percent ? '%' : ''}`, tone: diff > 0 ? 'up' : 'down' };
}

const PATHWAY_CODES: Record<string, string> = {
  'ai-emerging-technology': 'AI',
  'research-innovation': 'RI',
  'entrepreneurship-product': 'EP',
  'fintech-economics': 'FE',
  'core-future-skills': 'CF',
};

/** Authored course code when present, otherwise the pathway short label. Never a derived slug code. */
export function coursePartLabel(course: { code?: string | null; pathway?: string | null }): string {
  if (course.code && course.code.trim()) return course.code.trim();
  return PATHWAY_CODES[course.pathway ?? ''] ?? 'CF';
}

/**
 * Target band for a tolerance bar, only when a real schedule exists: expected progress from
 * start to due date, ±10 points. Self-paced work has no band.
 */
export function paceBand(startedAt: Date | string | null | undefined, dueAt: Date | string | null | undefined, now: Date = new Date()): [number, number] | null {
  if (!startedAt || !dueAt) return null;
  const start = new Date(startedAt).getTime();
  const due = new Date(dueAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(due) || due <= start) return null;
  const expected = Math.max(0, Math.min(100, ((now.getTime() - start) / (due - start)) * 100));
  return [Math.max(0, expected - 10), Math.min(100, expected + 10)];
}

/** The last `n` Vietnam calendar days, oldest first, as YYYY-MM-DD keys. */
export function lastVietnamDays(n: number, now: Date = new Date()): string[] {
  return Array.from({ length: n }, (_, index) => vietnamDay(new Date(now.getTime() - (n - 1 - index) * 86_400_000)));
}

const validDate = (value: Date | string | null | undefined) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

/** Intl locale for the app locale: vi-VN or en-US (numbers, times). */
export function intlLocale(locale: string | null | undefined): 'vi-VN' | 'en-US' {
  return locale === 'vi' || locale === 'vi-VN' ? 'vi-VN' : 'en-US';
}

/** Mono dash for missing or unparseable instants, so one bad row never fails a page. 24-hour ICT. */
export function ictTime(value: Date | string | null | undefined = new Date(), locale?: string): string {
  const date = validDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(locale ? intlLocale(locale) : 'en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Ho_Chi_Minh' }).format(date);
}

export function ictDate(value: Date | string | null | undefined = new Date()): string {
  const date = validDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(date).replace(/\//g, '.');
}

/** Mono date and 24-hour time in ICT (`14.08.2026 10:00 ICT`), or a dash for a bad instant. */
export function ictDateTime(value: Date | string | null | undefined): string {
  const date = validDate(value);
  return date ? `${ictDate(date)} ${ictTime(date)} ICT` : '—';
}

/** A readable label for a slug id when no authored name exists (`data-literacy` → `Data literacy`). */
export function readableId(id: string): string {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toLocaleUpperCase() + words.slice(1) : id;
}

/** ISO week number, used in kickers (WK 39). */
export function isoWeek(date: Date = new Date()): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Countdown like `T−2d 14h`, or null when past. */
export function countdown(to: Date | string, now: Date = new Date()): string | null {
  const ms = new Date(to).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);
  return days > 0 ? `T−${days}d ${hours % 24}h` : `T−${hours}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

/** Week-over-week rank change: lower rank is better, so moving from #7 to #3 reads `▲ 4`. */
export function rankDelta(rank: number, previousRank: number | null | undefined): { text: string; tone: DeltaTone } {
  if (previousRank === null || previousRank === undefined) return { text: 'new', tone: 'new' };
  const diff = previousRank - rank;
  if (diff === 0) return { text: '·', tone: 'flat' };
  return { text: `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}`, tone: diff > 0 ? 'up' : 'down' };
}

type PrerequisiteCourse = { id: string; title: string; code?: string | null; prerequisites?: readonly string[]; enrollment: { status: unknown } | null };

/** Readable label for a prerequisite: its authored code, else its title, else the raw id. */
export function prerequisiteLabel(id: string, byId: ReadonlyMap<string, Pick<PrerequisiteCourse, 'title' | 'code'>>): string {
  const course = byId.get(id);
  return course?.code?.trim() || course?.title || id;
}

/** Every prerequisite of a course, labelled (dashboard "Depends on"). */
export function prerequisiteLabels(course: Pick<PrerequisiteCourse, 'prerequisites'>, catalog: readonly PrerequisiteCourse[]): string[] {
  const byId = new Map(catalog.map(entry => [entry.id, entry]));
  return (course.prerequisites ?? []).map(id => prerequisiteLabel(id, byId));
}

/** Prerequisites the learner has not completed yet (catalog "Needs …" tag). */
export function unmetPrerequisiteLabels(course: Pick<PrerequisiteCourse, 'prerequisites'>, catalog: readonly PrerequisiteCourse[]): string[] {
  const byId = new Map(catalog.map(entry => [entry.id, entry]));
  return (course.prerequisites ?? []).filter(id => byId.get(id)?.enrollment?.status !== 'completed').map(id => prerequisiteLabel(id, byId));
}
