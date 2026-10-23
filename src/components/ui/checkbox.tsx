import type { ComponentProps } from "react";
import { cn } from "@/lib/ui-cn";

// A native checkbox on purpose: live forms read event.target.checked and
// tests drive it with plain clicks. size-6 keeps the 24px minimum target.
export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-6 shrink-0 rounded border-input accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
