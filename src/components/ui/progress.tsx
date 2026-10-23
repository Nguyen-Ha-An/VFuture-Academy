import type { ComponentProps } from "react";
import { cn } from "@/lib/ui-cn";

export type ProgressProps = Omit<ComponentProps<"div">, "children"> & {
  /** Current value; omit for an indeterminate bar. */
  value?: number | null;
  max?: number;
  indicatorClassName?: string;
};

// A plain progressbar div (no Radix dependency): the indicator slides in from
// the left, and aria-valuenow is omitted while the value is unknown.
export function Progress({ className, indicatorClassName, value, max = 100, ...props }: ProgressProps) {
  const known = typeof value === "number" && Number.isFinite(value) && max > 0;
  const percent = known ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={known ? Math.min(max, Math.max(0, value)) : undefined}
      data-slot="progress"
      data-state={known ? (percent >= 100 ? "complete" : "loading") : "indeterminate"}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-primary/20", className)}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn("h-full w-full flex-1 bg-primary transition-transform motion-reduce:transition-none", indicatorClassName)}
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </div>
  );
}
