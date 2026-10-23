"use client";

import { useId, useRef, useState } from "react";
import { ChevronsUpDown, Check, X } from "lucide-react";

import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { commandFilter } from "@/lib/search-text";
import { cn } from "@/lib/ui-cn";

export type MultiComboboxOption = {
  id: string;
  label: string;
  /** Extra search text, e.g. the id or the other locale's label. */
  keywords?: readonly string[];
};

export type MultiComboboxProps = {
  /** Visible field label; also names the trigger and the list. */
  label: string;
  options: readonly MultiComboboxOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Trigger text and the search input's accessible name. */
  searchLabel: string;
  emptyText: string;
  /** Accessible name of a chip's remove button, e.g. `Remove ${name}`. */
  removeLabel: (name: string) => string;
  /**
   * Screen-reader word appended to a chosen option ("selected"). cmdk's own aria-selected marks the
   * highlighted option, and aria-checked on an option is rarely announced, so the chosen state is text.
   */
  selectedLabel: string;
  /** Resolves a selected id that is not among `options`. */
  fallbackLabel?: (id: string) => string;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Multi-select combobox for the learner shell: a Popover holding a cmdk list
 * with the shared diacritic-insensitive filter (src/lib/search-text.ts) ("khi hau" finds "Khí hậu").
 * Arrow keys move, Enter toggles, Escape closes and returns focus to the
 * trigger. Selected values render as `.vf-tag` chips with a remove button.
 */
export function MultiCombobox({
  label,
  options,
  value,
  onChange,
  searchLabel,
  emptyText,
  removeLabel,
  selectedLabel,
  fallbackLabel = (id) => id,
  describedBy,
  disabled,
  className,
}: MultiComboboxProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const triggerId = `${baseId}-trigger`;
  const selected = new Set(value);
  const labels = new Map(options.map((option) => [option.id, option.label]));
  const nameOf = (id: string) => labels.get(id) ?? fallbackLabel(id);

  const toggle = (id: string) => {
    onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id]);
  };

  // A removed chip takes its focused button with it; hand focus back to the trigger.
  const remove = (id: string) => {
    toggle(id);
    triggerRef.current?.focus();
  };

  return (
    <div className={cn("vf-mcb", className)}>
      <label id={labelId} htmlFor={triggerId} className="vf-mcb-label">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            id={triggerId}
            type="button"
            className="vf-mcb-trigger"
            aria-expanded={open}
            aria-describedby={describedBy}
            disabled={disabled}
          >
            <span className="min-w-0 truncate">{searchLabel}</span>
            <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="vf-mcb-popover w-(--radix-popover-trigger-width) min-w-64 p-0">
          <Command filter={commandFilter} label={searchLabel}>
            <CommandInput placeholder={searchLabel} wrapperClassName="h-11" className="h-11" />
            <CommandList label={label}>
              <CommandEmpty>{emptyText}</CommandEmpty>
              {options.map((option) => {
                const checked = selected.has(option.id);
                return (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    keywords={[option.label, ...(option.keywords ?? [])]}
                    onSelect={() => toggle(option.id)}
                    data-checked={checked || undefined}
                    className="vf-mcb-option min-h-11"
                  >
                    <Check aria-hidden="true" className={cn("size-4", checked ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 break-words">{option.label}</span>
                    {checked ? <span className="sr-only">{`, ${selectedLabel}`}</span> : null}
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value.length ? (
        <ul className="vf-mcb-chips" aria-label={label}>
          {value.map((id) => {
            const name = nameOf(id);
            return (
              <li key={id} className="vf-tag vf-mcb-chip" data-plain="">
                <span className="min-w-0 truncate">{name}</span>
                <button type="button" className="vf-mcb-remove" aria-label={removeLabel(name)} onClick={() => remove(id)} disabled={disabled}>
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
