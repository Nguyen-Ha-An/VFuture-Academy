"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import { STAFF_WORKSPACES, type StaffWorkspace } from "@/lib/workspaces";

const LABEL_KEY = {
  studio: "workspaceStudio",
  grading: "workspaceGrading",
  admin: "workspaceAdmin",
} as const satisfies Record<StaffWorkspace, string>;

/**
 * Switches between the three staff workspaces. Entries are resolved on the
 * server from every authorized scope, so a workspace is never hidden because
 * the currently active workspace filtered its permissions away.
 */
export function WorkspaceSwitcher({
  entries,
  active,
  onNavigate,
  stacked = false,
}: {
  entries: WorkspaceEntries;
  active: StaffWorkspace;
  onNavigate?: () => void;
  stacked?: boolean;
}) {
  const common = useTranslations("common");
  const available = STAFF_WORKSPACES.flatMap((workspace) => {
    const href = entries[workspace];
    return href ? [{ workspace, href }] : [];
  });
  if (available.length < 2) return null;

  return (
    <nav aria-label={common("workspaces")} className={stacked ? "px-1" : undefined}>
      <ul className={cn("flex gap-1", stacked ? "flex-col" : "flex-wrap items-center")}>
        {available.map(({ workspace, href }) => {
          const current = workspace === active;
          return (
            <li key={workspace}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  stacked && "w-full",
                  current
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {common(LABEL_KEY[workspace])}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
