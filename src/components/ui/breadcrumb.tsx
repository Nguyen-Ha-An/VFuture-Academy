import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";
import { cn } from "@/lib/ui-cn";

/** `aria-label` names the landmark; pass the translated string. */
export function Breadcrumb({ "aria-label": ariaLabel = "Breadcrumb", ...props }: ComponentProps<"nav">) {
  return <nav aria-label={ariaLabel} data-slot="breadcrumb" {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
  return <ol data-slot="breadcrumb-list" className={cn("flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5", className)} {...props} />;
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return <li data-slot="breadcrumb-item" className={cn("inline-flex min-w-0 items-center gap-1.5", className)} {...props} />;
}

export function BreadcrumbLink({ asChild, className, ...props }: ComponentProps<"a"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "a";
  return <Comp data-slot="breadcrumb-link" className={cn("rounded-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} />;
}

export function BreadcrumbPage({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="breadcrumb-page" aria-current="page" className={cn("truncate font-normal text-foreground", className)} {...props} />;
}

export function BreadcrumbSeparator({ children, className, ...props }: ComponentProps<"li">) {
  return (
    <li data-slot="breadcrumb-separator" role="presentation" aria-hidden="true" className={cn("[&>svg]:size-3.5", className)} {...props}>
      {children ?? <ChevronRightIcon />}
    </li>
  );
}

/** `label` is the screen-reader text for the collapsed crumbs; pass the translated string. */
export function BreadcrumbEllipsis({ className, label = "More", ...props }: ComponentProps<"span"> & { label?: string }) {
  return (
    <span data-slot="breadcrumb-ellipsis" className={cn("flex size-9 items-center justify-center", className)} {...props}>
      <MoreHorizontalIcon className="size-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
