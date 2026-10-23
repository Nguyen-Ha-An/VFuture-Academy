"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/ui-cn";
import { ViewToggle, type ViewMode } from "./ViewToggle";

export type DataToolbarFilterOption = { value: string; label: string };
export type DataToolbarFilter = {
  /** URL search param (or controlled `values` key) this select writes. */
  param: string;
  /** Visible to assistive tech as the select's name. */
  label: string;
  options: DataToolbarFilterOption[];
  /** The empty option; defaults to staffUi.kit.toolbar.all. Pass null to require a choice. */
  allLabel?: string | null;
};

/** Param updates: a string sets it, null or "" removes it. */
export type ParamUpdates = Record<string, string | null>;

export const VIEW_PARAM = "view";
const DEFAULT_RESET_PARAMS = ["page", "cursor"];

/**
 * Applies updates to the current query string and replaces the URL without scrolling.
 * Paging params reset when a filter changes so a narrowed list never opens on an empty page.
 * Shared by DataToolbar, SortableHead and DataPagination; it needs the Next app router.
 */
export function useUrlParamUpdater(resetParams: readonly string[] = DEFAULT_RESET_PARAMS) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The debounced search fires after later renders; always build on the newest params.
  const latest = useRef(searchParams);
  latest.current = searchParams;
  return useCallback(
    (updates: ParamUpdates, options: { resetPaging?: boolean } = {}) => {
      const next = new URLSearchParams(latest.current?.toString() ?? "");
      for (const [param, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(param);
        else next.set(param, value);
      }
      if (options.resetPaging !== false) for (const param of resetParams) next.delete(param);
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, resetParams, router],
  );
}

type ToolbarOwnProps = {
  /** Param for the search box; defaults to "q". Pass false to hide search. */
  searchParam?: string | false;
  searchLabel?: string;
  searchPlaceholder?: string;
  filters?: DataToolbarFilter[];
  /** Shows the list/grid toggle, persisted in the "view" param (list is the default and is not written). */
  viewToggle?: boolean;
  viewLabel?: string;
  /** Trailing slot, e.g. an export or "New" button. */
  actions?: ReactNode;
  clearLabel?: string;
  /** Names the toolbar region; defaults to staffUi.kit.toolbar.label. */
  label?: string;
  debounceMs?: number;
  className?: string;
};

export type DataToolbarProps = ToolbarOwnProps &
  (
    | {
        /** Controlled mode (no router): every param's current value, keyed by param. */
        values: Record<string, string | undefined>;
        onValuesChange: (next: Record<string, string>) => void;
        resetParams?: never;
      }
    | {
        values?: undefined;
        onValuesChange?: undefined;
        /** URL mode only: params removed whenever search or a filter changes. Defaults to page and cursor. */
        resetParams?: readonly string[];
      }
  );

/**
 * Search, filters, view toggle and actions above a staff table. With `values` and
 * `onValuesChange` it is fully controlled and never touches the router; otherwise it
 * reads and writes URL search params with router.replace.
 */
export function DataToolbar(props: DataToolbarProps) {
  if (props.values) {
    const { values, onValuesChange, ...rest } = props;
    return <ControlledToolbar {...rest} values={values} onValuesChange={onValuesChange} />;
  }
  const { resetParams, values: _values, onValuesChange: _onValuesChange, ...rest } = props;
  return <UrlToolbar {...rest} resetParams={resetParams} />;
}

function ControlledToolbar({
  values,
  onValuesChange,
  ...props
}: ToolbarOwnProps & { values: Record<string, string | undefined>; onValuesChange: (next: Record<string, string>) => void }) {
  const commit = (updates: ParamUpdates) => {
    const next: Record<string, string> = {};
    for (const [param, value] of Object.entries(values)) if (value !== undefined) next[param] = value;
    for (const [param, value] of Object.entries(updates)) next[param] = value ?? "";
    onValuesChange(next);
  };
  return <ToolbarView {...props} read={(param) => values[param] ?? ""} commit={commit} />;
}

function UrlToolbar({ resetParams, ...props }: ToolbarOwnProps & { resetParams?: readonly string[] }) {
  const searchParams = useSearchParams();
  const update = useUrlParamUpdater(resetParams);
  return (
    <ToolbarView
      {...props}
      read={(param) => searchParams?.get(param) ?? ""}
      commit={(updates, options) => update(updates, options)}
    />
  );
}

function ToolbarView({
  searchParam = "q",
  searchLabel,
  searchPlaceholder,
  filters = [],
  viewToggle = false,
  viewLabel,
  actions,
  clearLabel,
  label,
  debounceMs = 250,
  className,
  read,
  commit,
}: ToolbarOwnProps & { read: (param: string) => string; commit: (updates: ParamUpdates, options?: { resetPaging?: boolean }) => void }) {
  const t = useTranslations("staffUi.kit.toolbar");
  const searchId = useId();
  const committedSearch = searchParam ? read(searchParam) : "";

  // Draft text follows the committed value when it changes from outside (Clear filters,
  // back/forward), but not when the change is the echo of what this box just sent.
  const [draft, setDraft] = useState(committedSearch);
  const [seen, setSeen] = useState(committedSearch);
  const [sent, setSent] = useState(committedSearch);
  if (committedSearch !== seen) {
    setSeen(committedSearch);
    if (committedSearch !== sent) setDraft(committedSearch);
  }

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const cancelPending = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const committedRef = useRef(committedSearch);
  committedRef.current = committedSearch;

  // Only a real change is written, so typing a trailing space never resets the page.
  const sendSearch = (value: string) => {
    if (!searchParam) return;
    cancelPending();
    setSent(value.trim());
    if (value.trim() === committedRef.current.trim()) return;
    commitRef.current({ [searchParam]: value.trim() || null });
  };

  const onSearchChange = (value: string) => {
    setDraft(value);
    cancelPending();
    timer.current = setTimeout(() => sendSearch(value), debounceMs);
  };

  const activeFilters = filters.filter((filter) => read(filter.param) !== "");
  const hasActive = committedSearch !== "" || draft.trim() !== "" || activeFilters.length > 0;

  const clearAll = () => {
    cancelPending();
    setDraft("");
    setSent("");
    const updates: ParamUpdates = {};
    if (searchParam) updates[searchParam] = null;
    for (const filter of filters) updates[filter.param] = null;
    commitRef.current(updates);
  };

  const view: ViewMode = read(VIEW_PARAM) === "grid" ? "grid" : "list";

  return (
    <div
      role="search"
      aria-label={label ?? t("label")}
      data-slot="data-toolbar"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {searchParam ? (
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <label htmlFor={searchId} className="sr-only">
            {searchLabel ?? t("search")}
          </label>
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchId}
            type="search"
            value={draft}
            placeholder={searchPlaceholder ?? t("searchPlaceholder")}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                sendSearch(draft);
              }
            }}
            className="pl-8"
          />
        </div>
      ) : null}
      {filters.map((filter) => {
        const allLabel = filter.allLabel === undefined ? t("all") : filter.allLabel;
        return (
          <NativeSelect
            key={filter.param}
            aria-label={filter.label}
            value={read(filter.param)}
            onChange={(event) => commitRef.current({ [filter.param]: event.target.value || null })}
            wrapperClassName="min-w-36"
          >
            {allLabel !== null ? <NativeSelectOption value="">{allLabel}</NativeSelectOption> : null}
            {filter.options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        );
      })}
      {hasActive ? (
        <Button variant="ghost" size="sm" onClick={clearAll} className="h-9">
          <XIcon aria-hidden="true" />
          {clearLabel ?? t("clearFilters")}
        </Button>
      ) : null}
      {viewToggle || actions ? (
        <div className="ml-auto flex items-center gap-2">
          {viewToggle ? (
            <ViewToggle
              value={view}
              label={viewLabel}
              onValueChange={(mode) => commitRef.current({ [VIEW_PARAM]: mode === "grid" ? "grid" : null }, { resetPaging: false })}
            />
          ) : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
