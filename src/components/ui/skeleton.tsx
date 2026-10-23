import type { ComponentProps } from "react";
import { cn } from "@/lib/ui-cn";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} {...props} />;
}
