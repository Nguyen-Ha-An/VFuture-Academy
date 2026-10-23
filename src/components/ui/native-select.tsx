import type { ComponentProps } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/ui-cn";

export type NativeSelectProps = ComponentProps<"select"> & { wrapperClassName?: string };

// A styled native <select>: same 36px height as Input, custom chevron, and
// every select prop forwarded so forms and userEvent.selectOptions keep working.
export function NativeSelect({ className, wrapperClassName, ...props }: NativeSelectProps) {
  return (
    <div data-slot="native-select-wrapper" className={cn("group/native-select relative w-fit has-[select:disabled]:opacity-50", wrapperClassName)}>
      <select
        data-slot="native-select"
        className={cn(
          "h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-transparent py-1 pl-3 pr-9 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-destructive [&>option]:bg-popover [&>option]:text-popover-foreground",
          className,
        )}
        {...props}
      />
      <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function NativeSelectOption(props: ComponentProps<"option">) {
  return <option data-slot="native-select-option" {...props} />;
}

export function NativeSelectOptGroup(props: ComponentProps<"optgroup">) {
  return <optgroup data-slot="native-select-optgroup" {...props} />;
}
