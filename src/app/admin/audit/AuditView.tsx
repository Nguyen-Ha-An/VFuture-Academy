import Link from "next/link";
import { HistoryIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataCard, DataPagination, EmptyState } from "@/features/staff-ui/components";
import { StaffPageHeader } from "@/features/workspace/ui/StaffPageHeader";

export type AuditViewRow = {
  id: string;
  /** ISO timestamp for <time dateTime>. */
  at: string;
  /** Already formatted for the viewer's locale. */
  time: string;
  action: { label: string; rawCode: string | null };
  /** null = no actor recorded, shown as "System". */
  actor: { name: string; href: string; filterLabel: string; isId: boolean } | null;
  /** `name` is the member or school the event is about, when it could be resolved. */
  target: { label: string; id: string; name?: string | null };
};

export type AuditViewProps = {
  title: string;
  description: string;
  /** Current filter values, echoed into the GET form. */
  filters: { action: string; target: string; actor: string };
  familyOptions: { value: string; label: string }[];
  /** Set when the list is narrowed to one actor. */
  actorFilter?: { label: string; clearHref: string; clearLabel: string };
  /** Set when any filter is active. */
  clearHref?: string;
  rows: AuditViewRow[];
  page: number;
  hasMore: boolean;
  previousHref: string | null;
  nextHref: string | null;
  labels: {
    family: string;
    allFamilies: string;
    target: string;
    targetPlaceholder: string;
    apply: string;
    clearFilters: string;
    listTitle: string;
    time: string;
    action: string;
    actor: string;
    targetColumn: string;
    system: string;
    pagination: string;
    emptyTitle: string;
    emptyDescription: string;
  };
};

/**
 * /admin/audit: filter form (action family + target), activity table with readable action and
 * target labels, actor names linking to their own history, and "Page n" paging (no total).
 * Presentational and server-renderable: every string arrives translated.
 */
export function AuditView({ title, description, filters, familyOptions, actorFilter, clearHref, rows, page, hasMore, previousHref, nextHref, labels }: AuditViewProps) {
  return (
    <section className="space-y-6">
      <StaffPageHeader title={title} description={description} />
      <DataCard
        title={labels.listTitle}
        toolbar={
          <div className="flex flex-col gap-3">
            <form method="get" role="search" aria-label={labels.apply} className="flex flex-wrap items-end gap-2">
              {filters.actor ? <input type="hidden" name="actor" value={filters.actor} /> : null}
              <NativeSelect name="action" aria-label={labels.family} defaultValue={filters.action} wrapperClassName="min-w-44">
                <NativeSelectOption value="">{labels.allFamilies}</NativeSelectOption>
                {familyOptions.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
                ))}
              </NativeSelect>
              <Input
                type="search"
                name="target"
                aria-label={labels.target}
                placeholder={labels.targetPlaceholder}
                defaultValue={filters.target}
                maxLength={160}
                className="w-full min-w-48 flex-1 sm:max-w-xs"
              />
              <Button type="submit" variant="outline">{labels.apply}</Button>
              {clearHref ? (
                <Button asChild variant="ghost" size="sm" className="h-9">
                  <Link href={clearHref}>
                    <XIcon aria-hidden="true" />
                    {labels.clearFilters}
                  </Link>
                </Button>
              ) : null}
            </form>
            {actorFilter ? (
              <p className="flex flex-wrap items-center gap-2 text-sm leading-normal text-muted-foreground">
                <span>{actorFilter.label}</span>
                <Link href={actorFilter.clearHref} className="font-medium text-foreground underline underline-offset-4">{actorFilter.clearLabel}</Link>
              </p>
            ) : null}
          </div>
        }
        footer={rows.length || page > 1 ? (
          <DataPagination
            mode="hasMore"
            page={page}
            hasMore={hasMore}
            previousHref={previousHref}
            nextHref={nextHref}
            label={labels.pagination}
          />
        ) : undefined}
      >
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<HistoryIcon />} title={labels.emptyTitle} description={labels.emptyDescription} />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col" className="hidden md:table-cell">{labels.time}</TableHead>
                <TableHead scope="col">{labels.action}</TableHead>
                <TableHead scope="col">{labels.actor}</TableHead>
                <TableHead scope="col" className="hidden md:table-cell">{labels.targetColumn}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                // No mono and no bare UUIDs: the resolved name leads, the id is only a tooltip.
                const target = row.target.name
                  ? <><span className="block leading-normal">{row.target.name}</span><span className="block text-xs leading-normal text-muted-foreground" title={row.target.id}>{row.target.label}</span></>
                  : <><span className="block leading-normal">{row.target.label}</span><span className="block max-w-56 truncate text-xs leading-normal text-muted-foreground tabular-nums" title={row.target.id}>{row.target.id}</span></>;
                return <TableRow key={row.id} className="align-top">
                  <TableCell className="hidden whitespace-nowrap py-3 tabular-nums text-muted-foreground md:table-cell">
                    <time dateTime={row.at}>{row.time}</time>
                  </TableCell>
                  <TableCell className="min-w-40 whitespace-normal py-3">
                    <span className="block font-medium leading-normal">{row.action.label}</span>
                    {row.action.rawCode ? (
                      <span className="mt-1 block text-xs leading-normal text-muted-foreground tabular-nums">{row.action.rawCode}</span>
                    ) : null}
                    {/* On phones the time and target columns fold in here as meta. */}
                    <span className="mt-1 block text-xs leading-normal text-muted-foreground md:hidden">
                      <time dateTime={row.at} className="tabular-nums">{row.time}</time>
                      {" · "}{row.target.name ?? row.target.label}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal py-3">
                    {row.actor ? (
                      <Link
                        href={row.actor.href}
                        title={row.actor.filterLabel}
                        className={row.actor.isId
                          ? "block max-w-40 truncate text-xs leading-normal text-muted-foreground tabular-nums underline-offset-4 hover:underline"
                          : "leading-normal underline-offset-4 hover:underline"}
                      >
                        {row.actor.name}
                      </Link>
                    ) : (
                      <span className="leading-normal text-muted-foreground">{labels.system}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden py-3 md:table-cell">{target}</TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>
        )}
      </DataCard>
    </section>
  );
}
