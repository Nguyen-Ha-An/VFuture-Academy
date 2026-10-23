"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BellIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { responseData, scopedUrl } from "@/features/admin/components/member-admin-ui";
import type { AdminScope } from "@/lib/admin-scope";
import type { Permission } from "@/lib/permissions";
import { routes } from "@/lib/routes";
import type { StaffWorkspace } from "@/lib/workspaces";

export type AttentionPopoverProps = {
  workspace: StaffWorkspace;
  permissions: Permission[];
  activeScope?: AdminScope;
};

type Count = { count: number; more: boolean };
type SourceState = { status: "idle" } | { status: "loading"; last?: Count } | { status: "ready"; value: Count } | { status: "error" };
type SourceKey = "reviews" | "submissions";

const REVIEWS_ENDPOINT = "/api/v1/studio/reviews";
const SUBMISSIONS_ENDPOINT = "/api/v1/studio/submissions";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Pending content reviews; the endpoint lists every review the scope may read. */
function pendingReviews(data: unknown): Count {
  if (!Array.isArray(data)) throw new Error("invalid_reviews_response");
  return { count: data.filter((row) => record(row)?.status === "pending").length, more: false };
}

/** First queue page of submitted work; a next cursor means there are more than we counted. */
function waitingSubmissions(data: unknown): Count {
  const page = record(data);
  if (!page || !Array.isArray(page.items)) throw new Error("invalid_queue_response");
  return { count: page.items.length, more: typeof page.nextCursor === "string" && page.nextCursor.length > 0 };
}

function endpointUrl(path: string, scope: AdminScope | undefined, params: Record<string, string | undefined> = {}): string {
  if (scope) return scopedUrl(path, scope, params);
  const search = new URLSearchParams(Object.entries(params).flatMap(([key, value]) => (value ? [[key, value]] : [])));
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * Top-bar bell. Counts are read only when the popover opens (never on mount) from
 * endpoints the active workspace may read; without either permission it renders nothing.
 */
export function AttentionPopover({ permissions, activeScope }: AttentionPopoverProps) {
  const t = useTranslations("staffUi.shell.command.attention");
  const canReview = permissions.includes("content.review") || permissions.includes("content.publish");
  const canGrade = permissions.includes("submission.grade");
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<Record<SourceKey, SourceState>>({ reviews: { status: "idle" }, submissions: { status: "idle" } });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  if (!canReview && !canGrade) return null;

  const rows = [
    ...(canReview
      ? [{ key: "reviews" as const, href: routes.studio.reviews(), label: t("pendingReviews"), url: endpointUrl(REVIEWS_ENDPOINT, activeScope), read: pendingReviews }]
      : []),
    ...(canGrade
      ? [{
          key: "submissions" as const,
          href: routes.grading.queue(),
          label: t("waitingSubmissions"),
          // The queue filters by branch; the scope parameter itself is ignored there.
          url: endpointUrl(SUBMISSIONS_ENDPOINT, activeScope, { status: "submitted", branchId: activeScope?.kind === "branch" ? activeScope.branchId : undefined }),
          read: waitingSubmissions,
        }]
      : []),
  ];

  function load() {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    for (const row of rows) {
      setSources((current) => {
        const previous = current[row.key];
        return { ...current, [row.key]: { status: "loading", last: previous.status === "ready" ? previous.value : undefined } };
      });
      fetch(row.url, { signal: controller.signal, cache: "no-store", headers: { accept: "application/json" } })
        .then((response) => responseData<unknown>(response))
        .then((data) => {
          const value = row.read(data);
          if (!controller.signal.aborted) setSources((current) => ({ ...current, [row.key]: { status: "ready", value } }));
        })
        .catch(() => {
          if (!controller.signal.aborted) setSources((current) => ({ ...current, [row.key]: { status: "error" } }));
        });
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) load();
    else controllerRef.current?.abort();
  }

  const format = ({ count, more }: Count) => (more ? t("countMore", { count }) : String(count));
  const known = rows.flatMap((row) => {
    const state = sources[row.key];
    return state.status === "ready" ? [state.value] : state.status === "loading" && state.last ? [state.last] : [];
  });
  const total = known.reduce((sum, value) => sum + value.count, 0);
  const totalMore = known.some((value) => value.more);
  const badge = known.length && total > 0 ? (total > 99 ? "99+" : format({ count: total, more: totalMore })) : null;
  const settled = rows.every((row) => sources[row.key].status === "ready");
  const nothing = settled && total === 0;
  const busy = rows.some((row) => sources[row.key].status === "loading");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={badge ? t("labelWithCount", { count: badge }) : t("label")}
          className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        >
          <BellIcon className="size-4" aria-hidden="true" />
          {badge ? (
            <span
              aria-hidden="true"
              data-slot="attention-badge"
              className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold leading-none text-background tabular-nums"
            >
              {badge}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <p className="border-b border-border px-3 py-2 text-sm font-medium leading-[1.4]">{t("title")}</p>
        <div aria-live="polite" aria-busy={busy || undefined} className="p-1">
          {nothing ? (
            <p className="px-2 py-3 text-sm leading-[1.4] text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((row) => {
                const state = sources[row.key];
                const value =
                  state.status === "ready" ? format(state.value)
                  : state.status === "error" ? t("unavailable")
                  : state.status === "loading" && state.last ? format(state.last)
                  : t("loading");
                return (
                  <li key={row.key}>
                    <Link
                      href={row.href}
                      onClick={() => setOpen(false)}
                      data-state={state.status}
                      className="flex min-h-8 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm font-medium leading-[1.4] outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 truncate">{row.label}</span>
                      <span className={state.status === "ready" ? "shrink-0 tabular-nums" : "shrink-0 text-xs font-normal text-muted-foreground"}>{value}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
