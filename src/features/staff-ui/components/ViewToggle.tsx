"use client";

import type { ComponentProps } from "react";
import { LayoutGridIcon, ListIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui-cn";

export const VIEW_MODES = ["list", "grid"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

const ICONS = { list: ListIcon, grid: LayoutGridIcon } satisfies Record<ViewMode, unknown>;

export type ViewToggleProps = Omit<ComponentProps<"div">, "onChange"> & {
  value: ViewMode;
  onValueChange: (value: ViewMode) => void;
  /** Group name; defaults to staffUi.kit.view.label. */
  label?: string;
  /** Per-option names; default to staffUi.kit.view.{list,grid}. */
  optionLabels?: Partial<Record<ViewMode, string>>;
};

/** Icon-only segmented control; each button names itself and reports aria-pressed. */
export function ViewToggle({ value, onValueChange, label, optionLabels, className, ...props }: ViewToggleProps) {
  const t = useTranslations("staffUi.kit.view");
  return (
    <div
      role="group"
      aria-label={label ?? t("label")}
      data-slot="view-toggle"
      className={cn("inline-flex h-9 items-center gap-0.5 rounded-md border border-input p-0.5", className)}
      {...props}
    >
      {VIEW_MODES.map((mode) => {
        const Icon = ICONS[mode];
        const pressed = value === mode;
        return (
          <Button
            key={mode}
            variant="ghost"
            size="icon-sm"
            aria-pressed={pressed}
            aria-label={optionLabels?.[mode] ?? t(mode)}
            onClick={() => {
              if (!pressed) onValueChange(mode);
            }}
            className={cn("size-7 rounded-sm text-muted-foreground", pressed && "bg-accent text-accent-foreground")}
          >
            <Icon aria-hidden="true" />
          </Button>
        );
      })}
    </div>
  );
}
