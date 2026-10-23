"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { MoreHorizontalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmationDialog } from "@/features/admin/components/member-admin-ui";
import { cn } from "@/lib/ui-cn";

export type RowActionConfirm = { title: string; description: string; confirmLabel?: string };

type RowActionBase = {
  label: string;
  /** Decorative leading icon element. */
  icon?: ReactNode;
  disabled?: boolean;
  /** Red text; the first destructive item gets a separator above it. */
  destructive?: boolean;
};

export type RowAction = RowActionBase &
  (
    | { href: string; onSelect?: never; confirm?: never }
    | {
        onSelect: () => void | Promise<void>;
        href?: never;
        /** Ask before running onSelect, e.g. for Revoke or Delete. */
        confirm?: RowActionConfirm;
      }
  );

export type RowActionsProps = {
  items: RowAction[];
  /** The trigger's accessible name, ideally naming the row ("Actions for Lan Nguyen"). Defaults to staffUi.kit.rowActions.label. */
  label?: string;
  align?: "start" | "center" | "end";
  className?: string;
};

/**
 * The "…" menu at the end of a table row. Link items navigate; others run onSelect,
 * optionally after the shared ConfirmationDialog. Returns nothing when there are no items,
 * so permission-filtered rows do not show an empty menu.
 */
export function RowActions({ items, label, align = "end", className }: RowActionsProps) {
  const t = useTranslations("staffUi.kit.rowActions");
  const [pending, setPending] = useState<Extract<RowAction, { onSelect: unknown }> | null>(null);
  if (items.length === 0) return null;
  const firstDestructive = items.findIndex((item) => item.destructive);

  return (
    <>
      {/* Non-modal so the confirmation dialog can take focus cleanly after the menu closes. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={label ?? t("label")} className={cn("text-muted-foreground data-[state=open]:bg-accent", className)}>
            <MoreHorizontalIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="min-w-40">
          {items.map((item, index) => (
            <Fragment key={`${item.label}-${index}`}>
              {index === firstDestructive && index > 0 ? <DropdownMenuSeparator /> : null}
              {item.href !== undefined ? (
                <DropdownMenuItem asChild disabled={item.disabled} variant={item.destructive ? "destructive" : "default"}>
                  <Link href={item.href}>
                    {item.icon}
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={item.disabled}
                  variant={item.destructive ? "destructive" : "default"}
                  onSelect={() => {
                    if (item.confirm) setPending(item);
                    else void item.onSelect();
                  }}
                >
                  {item.icon}
                  {item.label}
                </DropdownMenuItem>
              )}
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {pending?.confirm ? (
        <ConfirmationDialog
          open
          title={pending.confirm.title}
          description={pending.confirm.description}
          confirmLabel={pending.confirm.confirmLabel}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            void action.onSelect();
          }}
        />
      ) : null}
    </>
  );
}
