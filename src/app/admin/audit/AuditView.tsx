"use client";
import "@/features/admin/ui/admin.css";
import Link from "next/link";
import { useState } from "react";
import { HistoryIcon, XIcon } from "lucide-react";

import { CanvasButton as Button, CanvasTextInput, CanvasSelect, CanvasDataTable } from "@/features/canvas/ui";
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
  const [family, setFamily] = useState(filters.action);
  return (
    <section className="canvas-page canvas-admin space-y-6">
      <StaffPageHeader title={title} description={description} />
      <DataCard
        className="canvas-panel"
        title={labels.listTitle}
        toolbar={
          <div className="flex flex-col gap-3">
            <form method="get" role="search" aria-label={labels.apply} className="canvas-toolbar flex flex-wrap items-end gap-2">
              {filters.actor ? <input type="hidden" name="actor" value={filters.actor} /> : null}
              <input type="hidden" name="action" value={family} />
              <CanvasSelect label={<span className="sr-only">{labels.family}</span>} aria-label={labels.family} value={family} onChange={setFamily} options={[{ value: "", label: labels.allFamilies }, ...familyOptions]} />
              <CanvasTextInput
                label={<span className="sr-only">{labels.target}</span>}
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
                <Button href={clearHref} variant="ghost" size="sm" renderIcon={<XIcon aria-hidden="true" />}>{labels.clearFilters}</Button>
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
          <CanvasDataTable caption={labels.listTitle} rows={rows} rowKey={(row) => row.id} columns={[
            { key: "time", label: labels.time, render: (row) => <time dateTime={row.at} className="tabular-nums">{row.time}</time> },
            { key: "action", label: labels.action, render: (row) => <div><span className="block font-medium">{row.action.label}</span>{row.action.rawCode ? <span className="mt-1 block text-xs text-muted-foreground">{row.action.rawCode}</span> : null}</div> },
            { key: "actor", label: labels.actor, render: (row) => row.actor ? <Link href={row.actor.href} title={row.actor.filterLabel} className={row.actor.isId ? "block max-w-40 truncate text-xs text-muted-foreground underline-offset-4 hover:underline" : "underline-offset-4 hover:underline"}>{row.actor.name}</Link> : <span className="text-muted-foreground">{labels.system}</span> },
            { key: "target", label: labels.targetColumn, render: (row) => row.target.name ? <><span className="block">{row.target.name}</span><span className="block text-xs text-muted-foreground" title={row.target.id}>{row.target.label}</span></> : <><span className="block">{row.target.label}</span><span className="block max-w-56 truncate text-xs text-muted-foreground" title={row.target.id}>{row.target.id}</span></> },
          ]} />
        )}
      </DataCard>
    </section>
  );
}
