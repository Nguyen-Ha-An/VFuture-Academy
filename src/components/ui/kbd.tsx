import type { ComponentProps } from "react";
import { cn } from "@/lib/ui-cn";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 select-none items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export function KbdGroup({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd data-slot="kbd-group" className={cn("inline-flex items-center gap-1", className)} {...props} />;
}
