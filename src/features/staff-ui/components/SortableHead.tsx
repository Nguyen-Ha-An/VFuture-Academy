"use client";

import type { ComponentProps, ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/ui-cn";
import { useUrlParamUpdater } from "./DataToolbar";

export type SortDirection = "asc" | "desc";
export type SortState = { column: string; direction: SortDirection } | null;

type SortableHeadOwnProps = {
  /** The sort key this column writes, e.g. "name". */
  column: string;
  /** Visible column name; also the button's accessible name. */
  children: ReactNode;
  /** Direction of the first click; defaults to ascending. */
  defaultDirection?: SortDirection;
  /** When false, a third click keeps the column sorted instead of returning to unsorted. */
  allowUnsorted?: boolean;
};

export type SortableHeadProps = Omit<ComponentProps<"th">, "children" | "onClick"> &
  SortableHeadOwnProps &
  (
    | {
        /** Callback mode (no router): the table's current sort. */
        sort: SortState;
        onSortChange: (next: SortState) => void;
        sortParam?: never;
        dirParam?: never;
      }
    | {
        sort?: undefined;
        onSortChange?: undefined;
        /** URL mode: params holding the sort key and direction; default "sort" and "dir". */
        sortParam?: string;
        dirParam?: string;
      }
  );

/** Unsorted → first direction → the other direction → unsorted (or back to the first). */
export function nextSort(current: SortState, column: string, defaultDirection: SortDirection = "asc", allowUnsorted = true): SortState {
  const other: SortDirection = defaultDirection === "asc" ? "desc" : "asc";
  if (!current || current.column !== column) return { column, direction: defaultDirection };
  if (current.direction === defaultDirection) return { column, direction: other };
  return allowUnsorted ? null : { column, direction: defaultDirection };
}

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const;

/**
 * A <th> whose button cycles the sort and reports it through aria-sort. Only render it
 * on columns the data source can really sort. With `sort` and `onSortChange` it is
 * controlled; otherwise it reads and writes the sort/dir URL params.
 */
export function SortableHead(props: SortableHeadProps) {
  if (props.onSortChange) return <SortableHeadView {...props} />;
  const { sortParam, dirParam, sort: _sort, onSortChange: _onSortChange, ...rest } = props;
  return <UrlSortableHead {...rest} sortParam={sortParam} dirParam={dirParam} />;
}

function UrlSortableHead({
  sortParam = "sort",
  dirParam = "dir",
  ...props
}: Omit<ComponentProps<"th">, "children" | "onClick"> & SortableHeadOwnProps & { sortParam?: string; dirParam?: string }) {
  const searchParams = useSearchParams();
  const update = useUrlParamUpdater();
  const column = searchParams?.get(sortParam);
  const sort: SortState = column ? { column, direction: searchParams?.get(dirParam) === "desc" ? "desc" : "asc" } : null;
  return (
    <SortableHeadView
      {...props}
      sort={sort}
      onSortChange={(next) => update({ [sortParam]: next?.column ?? null, [dirParam]: next?.direction ?? null })}
    />
  );
}

function SortableHeadView({
  column,
  children,
  defaultDirection = "asc",
  allowUnsorted = true,
  sort,
  onSortChange,
  className,
  sortParam: _sortParam,
  dirParam: _dirParam,
  ...props
}: Omit<ComponentProps<"th">, "children" | "onClick"> &
  SortableHeadOwnProps & { sort: SortState; onSortChange: (next: SortState) => void; sortParam?: string; dirParam?: string }) {
  const direction = sort?.column === column ? sort.direction : null;
  const Icon = direction === "asc" ? ArrowUpIcon : direction === "desc" ? ArrowDownIcon : ChevronsUpDownIcon;
  return (
    <TableHead aria-sort={direction ? ARIA_SORT[direction] : "none"} className={className} {...props}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSortChange(nextSort(sort, column, defaultDirection, allowUnsorted))}
        className={cn("-ml-2 h-8 px-2 font-medium", direction ? "text-foreground" : "text-muted-foreground")}
      >
        {children}
        <Icon aria-hidden="true" className={cn("size-3.5", !direction && "opacity-60")} />
      </Button>
    </TableHead>
  );
}
