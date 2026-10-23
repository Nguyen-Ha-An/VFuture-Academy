"use client";

import type { ComponentProps } from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/ui-cn";

export function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

export function SheetTrigger(props: ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose(props: ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

export function SheetPortal(props: ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

export function SheetOverlay({ className, ...props }: ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn("fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none!", className)}
      {...props}
    />
  );
}

const sideClasses = {
  right: "inset-y-0 right-0 h-full w-3/4 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right sm:max-w-sm",
  left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left sm:max-w-sm",
  top: "inset-x-0 top-0 h-auto border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top",
  bottom: "inset-x-0 bottom-0 h-auto border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
} as const;

export type SheetContentProps = ComponentProps<typeof SheetPrimitive.Content> & {
  side?: keyof typeof sideClasses;
  showCloseButton?: boolean;
  /** Accessible name of the corner close button; pass the translated string. */
  closeLabel?: string;
};

export function SheetContent({ className, children, side = "right", showCloseButton = true, closeLabel = "Close", ...props }: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 border-border bg-background text-foreground outline-none transition ease-in-out data-[state=open]:animate-in data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:duration-150 motion-reduce:animate-none!",
          sideClasses[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            aria-label={closeLabel}
            className="absolute right-4 top-4 inline-flex size-7 items-center justify-center rounded-md opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none data-[state=open]:bg-secondary [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
          >
            <XIcon aria-hidden="true" />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="sheet-header" className={cn("flex flex-col gap-1.5 p-6 pb-0", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="sheet-footer" className={cn("mt-auto flex flex-col gap-2 border-t border-border p-6", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("text-base font-semibold text-foreground", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
