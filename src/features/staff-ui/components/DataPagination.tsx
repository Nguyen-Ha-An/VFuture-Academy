"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/ui-cn";
import { useUrlParamUpdater } from "./DataToolbar";

type PaginationLabels = Partial<Record<"previous" | "next" | "loadMore" | "loading" | "rowsPerPage", string>>;

type CommonProps = {
  /** Names the nav landmark; defaults to staffUi.kit.pagination.label. */
  label?: string;
  labels?: PaginationLabels;
  /** Replaces the left-hand summary ("Showing a–b of N" / "Page n"). */
  summary?: ReactNode;
  className?: string;
};

type Navigation = {
  /** Callback navigation; takes precedence over links. */
  onPageChange?: (page: number) => void;
  /** Link navigation; when neither this nor onPageChange is given, links rewrite `pageParam` in the current URL. */
  hrefForPage?: (page: number) => string;
  pageParam?: string;
};

type PageSize = {
  /** Shows the rows-per-page select. */
  pageSizeOptions?: number[];
  /** Without it the select writes `pageSizeParam` to the URL and resets the page. */
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeParam?: string;
};

export type DataPaginationProps = CommonProps &
  (
    | ({ mode: "page"; page: number; pageSize: number; total: number } & Navigation & PageSize)
    | ({
        mode: "hasMore";
        page: number;
        hasMore: boolean;
        /** Cursor lists: explicit targets override page-number links. null disables the control. */
        previousHref?: string | null;
        nextHref?: string | null;
        pageSize?: number;
      } & Navigation &
        PageSize)
    | { mode: "loadMore"; hasMore: boolean; onLoadMore: () => void; loading?: boolean }
  );

type Target = { kind: "callback"; go: (page: number) => void } | { kind: "href"; href: (page: number) => string };

/** 1 … 4 5 6 … 20: first, last, the current page and its neighbours. */
export function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  let start = Math.max(2, Math.min(page - 1, pageCount - 4));
  let end = Math.min(pageCount - 1, Math.max(page + 1, 5));
  // A gap never hides a single page: show the page itself instead.
  if (start === 3) start = 2;
  if (end === pageCount - 2) end = pageCount - 1;
  const items: (number | "gap")[] = [1];
  if (start > 2) items.push("gap");
  for (let value = start; value <= end; value += 1) items.push(value);
  if (end < pageCount - 1) items.push("gap");
  items.push(pageCount);
  return items;
}

/**
 * Footer pagination for staff tables. "page" knows the total ("Showing a–b of N"),
 * "hasMore" only knows whether another page exists ("Page n", no total), and
 * "loadMore" appends in place. Navigation is callbacks, explicit hrefs, or URL links.
 */
export function DataPagination(props: DataPaginationProps) {
  if (props.mode === "loadMore") return <LoadMorePagination {...props} />;
  if (props.onPageChange) return <PagedPagination {...props} target={{ kind: "callback", go: props.onPageChange }} />;
  if (props.hrefForPage) return <PagedPagination {...props} target={{ kind: "href", href: props.hrefForPage }} />;
  return <UrlPagedPagination {...props} />;
}

type PagedProps = Exclude<DataPaginationProps, { mode: "loadMore" }>;

function UrlPagedPagination(props: PagedProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageParam = props.pageParam ?? "page";
  const href = (page: number) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    if (page <= 1) next.delete(pageParam);
    else next.set(pageParam, String(page));
    const query = next.toString();
    return query ? `${pathname}?${query}` : (pathname ?? "");
  };
  return <PagedPagination {...props} target={{ kind: "href", href }} />;
}

function LoadMorePagination({ hasMore, onLoadMore, loading = false, label, labels, summary, className }: Extract<DataPaginationProps, { mode: "loadMore" }>) {
  const t = useTranslations("staffUi.kit.pagination");
  if (!hasMore && !summary) return null;
  return (
    <nav aria-label={label ?? t("label")} data-slot="data-pagination" className={cn("flex flex-wrap items-center justify-between gap-3 text-sm", className)}>
      <div className="text-muted-foreground tabular-nums">{summary}</div>
      {hasMore ? (
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loading} aria-busy={loading || undefined}>
          {loading ? (labels?.loading ?? t("loading")) : (labels?.loadMore ?? t("loadMore"))}
        </Button>
      ) : null}
    </nav>
  );
}

function PagedPagination(props: PagedProps & { target: Target }) {
  const t = useTranslations("staffUi.kit.pagination");
  const { label, labels, summary, className, target, pageSizeOptions, onPageSizeChange, pageSizeParam } = props;

  let page: number;
  let pageCount: number | null = null;
  let summaryText: ReactNode;
  let previous: PageControlTarget;
  let next: PageControlTarget;

  if (props.mode === "page") {
    pageCount = Math.max(1, Math.ceil(props.total / Math.max(1, props.pageSize)));
    page = Math.min(Math.max(1, props.page), pageCount);
    const from = props.total === 0 ? 0 : (page - 1) * props.pageSize + 1;
    const to = Math.min(props.total, page * props.pageSize);
    summaryText = props.total === 0 ? t("noResults") : t("showing", { from, to, total: props.total });
    previous = page > 1 ? { page: page - 1 } : null;
    next = page < pageCount ? { page: page + 1 } : null;
  } else {
    page = Math.max(1, props.page);
    summaryText = t("page", { page });
    previous = props.previousHref !== undefined ? (props.previousHref ? { href: props.previousHref } : null) : page > 1 ? { page: page - 1 } : null;
    next = props.nextHref !== undefined ? (props.nextHref ? { href: props.nextHref } : null) : props.hasMore ? { page: page + 1 } : null;
  }

  const currentPageSize = props.pageSize;
  const showPageSize = Boolean(pageSizeOptions?.length && currentPageSize);

  return (
    <nav aria-label={label ?? t("label")} data-slot="data-pagination" className={cn("flex flex-wrap items-center justify-between gap-3 text-sm", className)}>
      <p className="text-muted-foreground tabular-nums">{summary ?? summaryText}</p>
      <div className="flex flex-wrap items-center gap-4">
        {showPageSize && pageSizeOptions && currentPageSize ? (
          onPageSizeChange ? (
            <PageSizeSelect label={labels?.rowsPerPage ?? t("rowsPerPage")} options={pageSizeOptions} value={currentPageSize} onChange={onPageSizeChange} />
          ) : (
            <UrlPageSizeSelect label={labels?.rowsPerPage ?? t("rowsPerPage")} options={pageSizeOptions} value={currentPageSize} param={pageSizeParam ?? "pageSize"} />
          )
        ) : null}
        <div className="flex items-center gap-1">
          <PageControl bordered target={target} to={previous} aria-label={labels?.previous ?? t("previous")}>
            <ChevronLeftIcon aria-hidden="true" />
            <span className="hidden sm:inline">{labels?.previous ?? t("previous")}</span>
          </PageControl>
          {pageCount !== null && pageCount > 1 ? (
            <ul className="hidden items-center gap-1 sm:flex">
              {pageWindow(page, pageCount).map((item, index) =>
                item === "gap" ? (
                  <li key={`gap-${index}`} aria-hidden="true" className="px-1 text-muted-foreground">
                    …
                  </li>
                ) : (
                  <li key={item}>
                    <PageControl
                      target={target}
                      to={item === page ? null : { page: item }}
                      current={item === page}
                      aria-label={t("goToPage", { page: item })}
                      className="min-w-8 px-2 tabular-nums"
                    >
                      {item}
                    </PageControl>
                  </li>
                ),
              )}
            </ul>
          ) : null}
          <PageControl bordered target={target} to={next} aria-label={labels?.next ?? t("next")}>
            <span className="hidden sm:inline">{labels?.next ?? t("next")}</span>
            <ChevronRightIcon aria-hidden="true" />
          </PageControl>
        </div>
      </div>
    </nav>
  );
}

type PageControlTarget = { page: number } | { href: string } | null;

function PageControl({
  target,
  to,
  current = false,
  bordered = false,
  className,
  children,
  "aria-label": ariaLabel,
}: {
  target: Target;
  to: PageControlTarget;
  current?: boolean;
  /** Previous/Next are outline buttons (Catmin); page numbers stay ghost. */
  bordered?: boolean;
  className?: string;
  children: ReactNode;
  "aria-label": string;
}) {
  const classes = cn("h-8 gap-1 px-2.5", current && "border-foreground/20 bg-accent text-accent-foreground", className);
  const variant = current || bordered ? "outline" : "ghost";
  // The current page and unavailable directions are real disabled buttons, never dead links.
  if (!to) {
    return (
      <Button variant={variant} size="sm" disabled={!current} aria-current={current ? "page" : undefined} aria-label={ariaLabel} className={classes}>
        {children}
      </Button>
    );
  }
  if ("href" in to || target.kind === "href") {
    const href = "href" in to ? to.href : (target as Extract<Target, { kind: "href" }>).href(to.page);
    return (
      <Button asChild variant={variant} size="sm" className={classes}>
        <Link href={href} scroll={false} aria-label={ariaLabel}>
          {children}
        </Link>
      </Button>
    );
  }
  const { go } = target;
  return (
    <Button variant={variant} size="sm" aria-label={ariaLabel} onClick={() => go(to.page)} className={classes}>
      {children}
    </Button>
  );
}

function PageSizeSelect({ label, options, value, onChange }: { label: string; options: number[]; value: number; onChange: (size: number) => void }) {
  const values = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span aria-hidden="true" className="hidden sm:inline">
        {label}
      </span>
      <NativeSelect aria-label={label} value={String(value)} onChange={(event) => onChange(Number(event.target.value))} className="h-8 tabular-nums text-foreground">
        {values.map((option) => (
          <NativeSelectOption key={option} value={String(option)}>
            {option}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

function UrlPageSizeSelect({ param, ...props }: { label: string; options: number[]; value: number; param: string }) {
  const update = useUrlParamUpdater();
  return <PageSizeSelect {...props} onChange={(size) => update({ [param]: String(size) })} />;
}
