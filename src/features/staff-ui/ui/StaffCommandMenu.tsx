"use client";

import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SearchIcon } from "lucide-react";
import { useApplePlatform, useCommandShortcut } from "@/components/command-shortcut";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/ui-cn";
import type { Permission } from "@/lib/permissions";
import type { WorkspaceEntries } from "@/lib/workspace-navigation";
import type { StaffWorkspace } from "@/lib/workspaces";

export type StaffCommandMenuProps = {
  workspace: StaffWorkspace;
  permissions: Permission[];
  entries: WorkspaceEntries;
  className?: string;
};

/** cmdk lives only in this chunk; the import is started on first intent (hover, focus, shortcut). */
const loadDialog = () => import("./StaffCommandDialog");
const StaffCommandDialog = lazy(() => loadDialog().then((module) => ({ default: module.StaffCommandDialog })));

/**
 * Top-bar search trigger plus the global ⌘K / Ctrl+K shortcut. The palette itself
 * (StaffCommandDialog, cmdk) is lazy so it stays out of the initial shell chunk.
 */
export function StaffCommandMenu({ workspace, permissions, entries, className }: StaffCommandMenuProps) {
  const t = useTranslations("staffUi.shell.command");
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState(false);
  const openRef = useRef(false);
  // Server snapshot is "not Apple" so the SSR markup is stable; the client corrects it after hydration.
  const apple = useApplePlatform();

  const setMenuOpen = useCallback((next: boolean) => {
    if (next) setRequested(true);
    openRef.current = next;
    setOpen(next);
  }, []);

  useCommandShortcut({
    isOpen: () => openRef.current,
    onToggle: (next) => {
      void loadDialog();
      setMenuOpen(next);
    },
  });

  const preload = () => void loadDialog();

  return (
    <>
      <button
        type="button"
        aria-label={t("trigger")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={apple ? "Meta+K" : "Control+K"}
        onClick={() => setMenuOpen(true)}
        onPointerEnter={preload}
        onFocus={preload}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-input bg-muted/40 px-2 text-sm font-normal leading-[1.4] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "w-8 justify-center sm:w-56 sm:justify-start lg:w-64",
          className,
        )}
      >
        <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
        <span className="hidden flex-1 truncate text-left sm:inline">{t("placeholder")}</span>
        <Kbd aria-hidden="true" className="hidden sm:inline-flex">
          {apple ? "⌘K" : "Ctrl K"}
        </Kbd>
      </button>
      {requested ? (
        <Suspense fallback={null}>
          <StaffCommandDialog open={open} onOpenChange={setMenuOpen} workspace={workspace} permissions={permissions} entries={entries} />
        </Suspense>
      ) : null}
    </>
  );
}
