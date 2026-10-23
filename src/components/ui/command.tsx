"use client";

import type { ComponentProps } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/ui-cn";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn("flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground", className)}
      {...props}
    />
  );
}

export type CommandDialogProps = ComponentProps<typeof Dialog> & {
  /** Visually hidden dialog title; pass the translated string. */
  title?: string;
  /** Visually hidden dialog description; pass the translated string. */
  description?: string;
  /** Accessible name of the corner close button. */
  closeLabel?: string;
  className?: string;
  showCloseButton?: boolean;
  /** Forwarded to cmdk, e.g. a diacritic-insensitive filter. cmdk names its
   * input from `label` (aria-labelledby), which defaults to `title`. */
  commandProps?: Omit<ComponentProps<typeof CommandPrimitive>, "children">;
  /** Forwarded to DialogContent, e.g. to move focus to a same-page target instead of the trigger. */
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
};

export function CommandDialog({
  title = "Command palette",
  description = "Search for a command to run",
  closeLabel,
  children,
  className,
  showCloseButton = true,
  commandProps,
  onCloseAutoFocus,
  ...props
}: CommandDialogProps) {
  return (
    <Dialog {...props}>
      <DialogContent className={cn("overflow-hidden p-0", className)} showCloseButton={showCloseButton} closeLabel={closeLabel} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command
          label={title}
          {...commandProps}
          className={cn(
            "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[data-slot=command-input-wrapper]]:h-12",
            commandProps?.className,
          )}
        >
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({ className, wrapperClassName, ...props }: ComponentProps<typeof CommandPrimitive.Input> & { wrapperClassName?: string }) {
  return (
    <div data-slot="command-input-wrapper" className={cn("flex h-9 items-center gap-2 border-b border-border px-3", wrapperClassName)}>
      <SearchIcon className="size-4 shrink-0 opacity-50" aria-hidden="true" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List data-slot="command-list" className={cn("max-h-[300px] scroll-py-1 overflow-y-auto overflow-x-hidden", className)} {...props} />;
}

export function CommandEmpty({ className, ...props }: ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty data-slot="command-empty" className={cn("py-6 text-center text-sm", className)} {...props} />;
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({ className, ...props }: ComponentProps<typeof CommandPrimitive.Separator>) {
  return <CommandPrimitive.Separator data-slot="command-separator" className={cn("-mx-1 h-px bg-border", className)} {...props} />;
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function CommandShortcut({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="command-shortcut" className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...props} />;
}
