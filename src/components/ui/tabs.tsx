"use client";

import type { ComponentProps } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/ui-cn";

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...props} />;
}

// "default" is the shadcn segmented control; "line" is an underlined tab row.
// Triggers read the list's variant through the group-data selectors below.
export function TabsList({ className, variant = "default", ...props }: ComponentProps<typeof TabsPrimitive.List> & { variant?: "default" | "line" }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        "group/tabs-list inline-flex w-fit items-center text-muted-foreground",
        variant === "default" ? "h-9 justify-center rounded-lg bg-muted p-[3px]" : "gap-1 border-b border-border",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 py-1 text-sm font-medium text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=default]/tabs-list:h-[calc(100%-1px)] group-data-[variant=default]/tabs-list:data-[state=active]:border-border group-data-[variant=default]/tabs-list:data-[state=active]:bg-background",
        "group-data-[variant=line]/tabs-list:-mb-px group-data-[variant=line]/tabs-list:flex-none group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:border-b-2 group-data-[variant=line]/tabs-list:px-3 group-data-[variant=line]/tabs-list:py-2 group-data-[variant=line]/tabs-list:text-muted-foreground group-data-[variant=line]/tabs-list:data-[state=active]:border-b-foreground group-data-[variant=line]/tabs-list:data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} />;
}
