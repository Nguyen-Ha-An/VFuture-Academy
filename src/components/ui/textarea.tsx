import type { ComponentProps } from "react";
import { cn } from "@/lib/ui-cn";

// Keeps the 6rem minimum height live forms rely on; callers raise it with
// their own min-h-* class, which now wins through tailwind-merge.
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive md:text-sm",
        className,
      )}
      {...props}
    />
  );
}
