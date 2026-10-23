import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/ui-cn";

// 22px pill: 12px/600 text, 2px vertical padding, 1px border. The soft tones
// read their colours from semantic tokens so light and dark both hold AA.
export const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/80",
        outline: "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90",
        success: "border-success-border bg-success text-success-foreground",
        info: "border-info-border bg-info text-info-foreground",
        warning: "border-warning-border bg-warning text-warning-foreground",
        danger: "border-destructive/30 bg-destructive/10 text-destructive-soft-foreground",
        neutral: "border-border bg-muted text-secondary-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean };

export function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : "span";
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
