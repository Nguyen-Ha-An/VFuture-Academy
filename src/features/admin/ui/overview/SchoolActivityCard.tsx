import { useId } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { SchoolActivity } from "@/features/admin/dashboard";
import { cn } from "@/lib/ui-cn";

/** A ranked school; `href` only when the viewer may open schools. */
export type SchoolActivityRow = SchoolActivity & { href?: string };

export type SchoolActivityCardProps = {
  state: "ready" | "unavailable";
  rows?: readonly SchoolActivityRow[];
  className?: string;
};

// "Schools by active learners": a ranked distribution. The numbers are text; the bars
// only repeat them visually (relative to the leading school), so they stay aria-hidden.
export function SchoolActivityCard({ state, rows = [], className }: SchoolActivityCardProps) {
  const t = useTranslations("staffUi.admin.overview.schools");
  const insights = useTranslations("staffUi.insights");
  const titleId = useId();
  const max = Math.max(0, ...rows.map((row) => row.activeLearners30d));
  return <section
    data-slot="school-activity"
    aria-labelledby={titleId}
    className={cn("flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground", className)}
  >
    <div className="flex min-w-0 flex-col gap-1">
      <h2 id={titleId} className="text-sm font-medium leading-normal">{t("title")}</h2>
      <p className="text-sm leading-normal text-muted-foreground">{t("description")}</p>
    </div>
    {state === "unavailable"
      ? <p className="text-sm leading-normal text-muted-foreground">{insights("unavailable")}</p>
      : rows.length === 0
        ? <p className="text-sm leading-normal text-muted-foreground">{t("empty")}</p>
        : <ol aria-label={t("label")} className="flex flex-col gap-4">
          {rows.map((row) => {
            const width = max > 0 && row.activeLearners30d > 0 ? Math.max(2, Math.round((row.activeLearners30d / max) * 100)) : 0;
            const href = row.href;
            return <li key={row.branchId} data-school={row.branchId} className="flex min-w-0 flex-col gap-1.5">
              <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm leading-normal">
                {href
                  ? <Link href={href} className="min-w-0 truncate font-medium underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">{row.name}</Link>
                  : <span className="min-w-0 truncate font-medium">{row.name}</span>}
                <span className="shrink-0 text-muted-foreground tabular-nums">{t("value", { count: row.activeLearners30d })}</span>
              </div>
              <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
              </div>
            </li>;
          })}
        </ol>}
  </section>;
}
