'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ComponentProps, type CSSProperties, type FormEvent, type MouseEvent } from 'react';
import { compactSearchParams } from '@/lib/search-params';

export type FilterSelectField = {
  kind: 'select';
  name: string;
  label: string;
  value?: string;
  allLabel: string;
  options: ReadonlyArray<{ value: string; label: string }>;
};
export type FilterSearchField = { kind: 'search'; name: string; label: string; value?: string; placeholder?: string; wide?: boolean };
/** A group of boolean filters; a checked box submits `name=true`, an unchecked one nothing. */
export type FilterChecksField = { kind: 'checks'; legend: string; items: ReadonlyArray<{ name: string; label: string; checked?: boolean }> };
export type FilterField = FilterSelectField | FilterSearchField | FilterChecksField;

export type FilterBarProps = {
  /** Accessible name of the form (role `form`). */
  label: string;
  /** Visible disclosure summary on phones, e.g. "Filters (2)". */
  summary: string;
  fields: FilterField[];
  /**
   * Values carried on every submit (the tab, or `featured=false` while it is active). A value whose
   * name matches a field is a fallback: it renders after the fields and yields to the field's own
   * value, so a checked box and its fallback never submit together.
   */
  hidden?: Readonly<Record<string, string>>;
  /** `filterStateKey(appliedFilters)`: remounts the uncontrolled form when the applied filters change. */
  stateKey: string;
  activeCount: number;
  clearHref: string;
  columns?: 2 | 3 | 4 | 5;
  applyLabel?: string;
  clearLabel?: string;
  /** Form target; defaults to the current pathname. */
  action?: string;
  /** Id of the results header (`tabIndex=-1`) that receives focus after the filters change. */
  resultsId?: string;
};

const WIDE = '(min-width: 760px)';

/**
 * The URL a submit or Clear is about to load, and when; focus follows it when the page remounts the
 * bar. It is consumed by the next bar effect and expires, so a stale entry (a navigation that never
 * remounted anything) can never move focus on a later, ordinary visit to the same URL.
 */
let pendingFocus: { href: string; at: number } | null = null;
const PENDING_FOCUS_MS = 10_000;

function takePendingFocus(): string | null {
  const pending = pendingFocus;
  pendingFocus = null;
  return pending && Date.now() - pending.at < PENDING_FOCUS_MS ? pending.href : null;
}

function sameUrl(a: string, b: string): boolean {
  if (typeof window === 'undefined') return false;
  const left = new URL(a, window.location.href);
  const right = new URL(b, window.location.href);
  if (left.pathname !== right.pathname) return false;
  const sorted = (url: URL) => [...url.searchParams].map(([key, value]) => `${key}=${value}`).sort().join('&');
  return sorted(left) === sorted(right);
}

function focusResults(id: string | undefined) {
  if (!id) return;
  document.getElementById(id)?.focus({ preventScroll: false });
}

/** A modified or non-primary click opens a new tab or window; the current page stays as it is. */
function opensElsewhere(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/**
 * A link that changes the applied filters from outside the form (a chip's remove link, an empty
 * state's Clear). The link itself goes away with the old results, so, as after Apply, focus moves
 * to the results header once the bar shows the new filters, even when the page remounts it.
 */
export function FilterLink({ href, onClick, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  return <Link
    {...props}
    href={href}
    onClick={event => {
      onClick?.(event);
      if (!event.defaultPrevented && !opensElsewhere(event)) pendingFocus = { href, at: Date.now() };
    }}
  />;
}

/**
 * The pager's focus hand-off. Paging changes only `page`, which the bar's `stateKey` leaves out, so
 * the bar never sees it; after a pager FilterLink this moves focus to the results header, both when
 * the page remounts (the bar, rendered earlier, usually takes it first) and when it re-renders in place.
 */
export function PagerFocus({ page, resultsId }: { page: number; resultsId?: string }) {
  const shownPage = useRef<number | null>(null);
  useEffect(() => {
    const previous = shownPage.current;
    shownPage.current = page;
    if (previous === page) return;
    const pending = pendingFocus;
    if (!pending || !sameUrl(pending.href, window.location.href)) return;
    if (takePendingFocus()) focusResults(resultsId);
  }, [page, resultsId]);
  return null;
}

/**
 * The directory filters: a disclosure on phones, a grid from 760px and one row with inline actions
 * from 1100px. The form stays uncontrolled; `key={stateKey}` remounts it whenever the applied
 * filters change, because React 19 never re-applies a changed `defaultValue` to a mounted
 * `<select>` (F2). Without JavaScript it is a plain GET form.
 */
export function FilterBar({
  label, summary, fields, hidden, stateKey, activeCount, clearHref, columns = 4, applyLabel, clearLabel, action, resultsId,
}: FilterBarProps) {
  const t = useTranslations('learner.directory');
  const router = useRouter();
  const pathname = usePathname();
  const target = action ?? pathname;
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const shownKey = useRef<string | null>(null);
  const fieldNames = new Set(fields.flatMap(field => field.kind === 'checks' ? field.items.map(item => item.name) : [field.name]));
  const carried = Object.entries(hidden ?? {});
  const leading = carried.filter(([name]) => !fieldNames.has(name));
  const fallbacks = carried.filter(([name]) => fieldNames.has(name));

  // Open state is imperative (never a controlled attribute): open when filters apply or the
  // viewport is wide, re-evaluated when either changes.
  useEffect(() => {
    const details = detailsRef.current;
    if (!details) return;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null;
    const sync = () => { details.open = activeCount > 0 || Boolean(media?.matches); };
    sync();
    media?.addEventListener?.('change', sync);
    return () => media?.removeEventListener?.('change', sync);
  }, [activeCount]);

  // Keyboard and screen-reader users keep their place: after the applied filters change, focus the
  // results header. Not on first mount, unless this bar just submitted and the page remounted it.
  useEffect(() => {
    const previous = shownKey.current;
    shownKey.current = stateKey;
    const pending = takePendingFocus();
    if (previous === null ? pending !== null && sameUrl(pending, window.location.href) : previous !== stateKey) focusResults(resultsId);
  }, [stateKey, resultsId]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    // A fallback renders after its field, so the field's value comes first; keep only that one.
    for (const [name] of fallbacks) {
      const [first] = data.getAll(name);
      data.delete(name);
      if (first !== undefined) data.append(name, first);
    }
    const query = compactSearchParams(data).toString();
    const href = query ? `${target}?${query}` : target;
    if (sameUrl(href, window.location.href)) {
      // Nothing changes, so nothing remounts: hand focus over now instead of leaving it pending.
      pendingFocus = null;
      focusResults(resultsId);
    } else {
      pendingFocus = { href, at: Date.now() };
    }
    router.push(href);
  };

  const onClear = (event: MouseEvent<HTMLAnchorElement>) => {
    if (opensElsewhere(event)) return;
    if (sameUrl(clearHref, window.location.href)) {
      event.preventDefault();
      formRef.current?.reset();
      return;
    }
    pendingFocus = { href: clearHref, at: Date.now() };
  };

  return <details ref={detailsRef} className="vf-l-disclosure vf-l-filters">
    <summary>{summary}</summary>
    <form
      key={stateKey}
      ref={formRef}
      method="get"
      action={target}
      aria-label={label}
      className="vf-l-filter-form"
      data-cols={columns}
      style={{ '--vf-filter-cols': columns } as CSSProperties}
      onSubmit={onSubmit}
    >
      {leading.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {fields.map(field => {
        if (field.kind === 'select') return <label key={field.name} className="vf-l-filter-field">
          <span className="vf-label">{field.label}</span>
          <select name={field.name} defaultValue={field.value ?? ''}>
            <option value="">{field.allLabel}</option>
            {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>;
        if (field.kind === 'search') return <label key={field.name} className="vf-l-filter-field" data-wide={field.wide ? '' : undefined}>
          <span className="vf-label">{field.label}</span>
          <input type="search" name={field.name} defaultValue={field.value ?? ''} placeholder={field.placeholder} />
        </label>;
        return <fieldset key={field.legend} className="vf-l-filter-checks">
          <legend className="vf-label">{field.legend}</legend>
          <div>{field.items.map(item => <label key={item.name}>
            <input type="checkbox" name={item.name} value="true" defaultChecked={Boolean(item.checked)} />
            <span>{item.label}</span>
          </label>)}</div>
        </fieldset>;
      })}
      {/* Without JavaScript both values submit, field first; the list parsers read the first value. */}
      {fallbacks.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <div className="vf-l-filter-actions">
        <button type="submit" className="vf-btn vf-btn-primary vf-btn-lg">{applyLabel ?? t('apply')}</button>
        <Link href={clearHref} className="vf-btn vf-btn-ghost vf-btn-lg" onClick={onClear}>{clearLabel ?? t('clear')}</Link>
      </div>
    </form>
  </details>;
}
