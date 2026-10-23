/**
 * Frozen copies of the pre-refresh primitives (Button, Input, Badge, DropdownMenu, Dialog, Sheet,
 * plus Table, Tabs, RadioGroup, Textarea and Checkbox, which the canonical upgrade also restyled).
 * Learner and public surfaces stay on these so the staff refresh can upgrade the canonical files
 * without changing their DOM. Do not restyle: tests/features/staff-ui/classic-snapshot.test.tsx pins
 * every class string. No "use client" here on purpose: Button/Input/Badge are still rendered from
 * server components, and the Radix modules carry their own client directive.
 */
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { type ButtonHTMLAttributes, type ComponentPropsWithoutRef, type ComponentRef, type HTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from "react";
import { twMerge } from "tailwind-merge";
import { cn } from "@/lib/utils";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={twMerge(cn("inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50", className))} {...props} />
  ),
);
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn("min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} />);
Input.displayName = "Input";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) { return <span className={cn("inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground", className)} {...props} />; }

export const DropdownMenu = Dropdown.Root;
export const DropdownMenuTrigger = Dropdown.Trigger;
export const DropdownMenuPortal = Dropdown.Portal;

export const DropdownMenuContent = forwardRef<ComponentRef<typeof Dropdown.Content>, ComponentPropsWithoutRef<typeof Dropdown.Content>>(
  ({ className, sideOffset = 8, collisionPadding = 8, ...props }, ref) => (
    <Dropdown.Content ref={ref} sideOffset={sideOffset} collisionPadding={collisionPadding}
      className={cn('z-50 w-80 max-w-[calc(100vw-1rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg', className)} {...props} />
  ),
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = forwardRef<ComponentRef<typeof Dropdown.Item>, ComponentPropsWithoutRef<typeof Dropdown.Item>>(
  ({ className, ...props }, ref) => (
    <Dropdown.Item ref={ref} className={cn('flex min-h-11 w-full cursor-default select-none items-center gap-2 rounded-md px-3 py-2 text-left text-sm leading-5 break-words outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[highlighted]:ring-2 data-[highlighted]:ring-inset data-[highlighted]:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50', className)} {...props} />
  ),
);
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuSeparator = forwardRef<ComponentRef<typeof Dropdown.Separator>, ComponentPropsWithoutRef<typeof Dropdown.Separator>>(
  ({ className, ...props }, ref) => <Dropdown.Separator ref={ref} className={cn('mx-1 my-1 h-px bg-border', className)} {...props} />,
);
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

export { Root as Dialog, Trigger as DialogTrigger, Portal as DialogPortal, Overlay as DialogOverlay, Content as DialogContent, Title as DialogTitle, Description as DialogDescription, Close as DialogClose } from "@radix-ui/react-dialog";
export { Root as Sheet, Trigger as SheetTrigger, Portal as SheetPortal, Overlay as SheetOverlay, Content as SheetContent, Title as SheetTitle, Description as SheetDescription, Close as SheetClose } from "@radix-ui/react-dialog";

export { Root as Tabs, List as TabsList, Trigger as TabsTrigger, Content as TabsContent } from "@radix-ui/react-tabs";
export { Root as RadioGroup, Item as RadioGroupItem } from "@radix-ui/react-radio-group";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) { return <div className="w-full overflow-x-auto"><table className={cn("w-full text-sm", className)} {...props} /></div>; }

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => <textarea ref={ref} className={cn("min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} />);
Textarea.displayName = "Textarea";

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} type="checkbox" className={cn("size-6 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)} {...props} />);
Checkbox.displayName = "Checkbox";
