import type { ComponentProps } from "react";
import { cn } from "@/lib/ui-cn";

// Native <label>; shadcn's Radix label adds nothing we need here.
export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("flex select-none items-center gap-2 text-sm font-medium leading-snug peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50", className)}
      {...props}
    />
  );
}
