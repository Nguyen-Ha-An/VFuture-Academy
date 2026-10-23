// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { afterEach, describe, expect, it } from 'vitest';

import * as Classic from '@/components/ui/classic';

/**
 * The classic primitives are the frozen pre-refresh look that learner and public surfaces keep.
 * These inline class strings are the contract: any edit to classic.tsx must show up here on purpose.
 */
const BUTTON = 'inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50';
const INPUT = 'min-h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring';
const BADGE = 'inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground';
const MENU_CONTENT = 'z-50 w-80 max-w-[calc(100vw-1rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg';
const MENU_ITEM = 'flex min-h-11 w-full cursor-default select-none items-center gap-2 rounded-md px-3 py-2 text-left text-sm leading-5 break-words outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[highlighted]:ring-2 data-[highlighted]:ring-inset data-[highlighted]:ring-ring data-[disabled]:pointer-events-none data-[disabled]:opacity-50';
const MENU_SEPARATOR = 'mx-1 my-1 h-px bg-border';
const TABLE = 'w-full text-sm';
const TABLE_WRAPPER = 'w-full overflow-x-auto';
const TEXTAREA = 'min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
const CHECKBOX = 'size-6 rounded border-input accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

afterEach(() => {
  cleanup();
});

describe('classic primitives', () => {
  it('keeps the Button default classes, type and display name', () => {
    render(<Classic.Button>Lưu / Save</Classic.Button>);
    const button = screen.getByRole('button', { name: 'Lưu / Save' });
    expect(button.getAttribute('class')).toBe(BUTTON);
    expect(button).toHaveAttribute('type', 'button');
    expect(Classic.Button.displayName).toBe('Button');
  });

  it('keeps the Button caller override behaviour (twMerge)', () => {
    render(<Classic.Button className="bg-background px-2">Go</Classic.Button>);
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button).toHaveClass('bg-background', 'px-2');
    expect(button).not.toHaveClass('bg-primary', 'px-4');
  });

  it('keeps the Input default classes and display name', () => {
    render(<Classic.Input aria-label="Email" />);
    expect(screen.getByRole('textbox', { name: 'Email' }).getAttribute('class')).toBe(INPUT);
    expect(Classic.Input.displayName).toBe('Input');
  });

  it('keeps the Badge default classes', () => {
    render(<Classic.Badge>Mới</Classic.Badge>);
    expect(screen.getByText('Mới').getAttribute('class')).toBe(BADGE);
  });

  it('keeps the DropdownMenu content, item and separator classes', () => {
    render(
      <Classic.DropdownMenu open modal={false}>
        <Classic.DropdownMenuTrigger>Menu</Classic.DropdownMenuTrigger>
        <Classic.DropdownMenuContent>
          <Classic.DropdownMenuItem>Hồ sơ</Classic.DropdownMenuItem>
          <Classic.DropdownMenuSeparator />
        </Classic.DropdownMenuContent>
      </Classic.DropdownMenu>,
    );
    expect(screen.getByRole('menu').getAttribute('class')).toBe(MENU_CONTENT);
    expect(screen.getByRole('menuitem', { name: 'Hồ sơ' }).getAttribute('class')).toBe(MENU_ITEM);
    expect(screen.getByRole('separator').getAttribute('class')).toBe(MENU_SEPARATOR);
    expect(Classic.DropdownMenuContent.displayName).toBe('DropdownMenuContent');
    expect(Classic.DropdownMenuItem.displayName).toBe('DropdownMenuItem');
    expect(Classic.DropdownMenuSeparator.displayName).toBe('DropdownMenuSeparator');
  });

  it('re-exports the bare Radix menu, dialog and sheet parts', () => {
    expect(Classic.DropdownMenu).toBe(DropdownPrimitive.Root);
    expect(Classic.DropdownMenuTrigger).toBe(DropdownPrimitive.Trigger);
    expect(Classic.DropdownMenuPortal).toBe(DropdownPrimitive.Portal);
    const parts = ['Root', 'Trigger', 'Portal', 'Overlay', 'Content', 'Title', 'Description', 'Close'] as const;
    const names = { Root: '', Trigger: 'Trigger', Portal: 'Portal', Overlay: 'Overlay', Content: 'Content', Title: 'Title', Description: 'Description', Close: 'Close' };
    for (const part of parts) {
      expect(Classic[`Dialog${names[part]}` as keyof typeof Classic]).toBe(DialogPrimitive[part]);
      expect(Classic[`Sheet${names[part]}` as keyof typeof Classic]).toBe(DialogPrimitive[part]);
    }
  });

  it('keeps the Table wrapper and classes without merging caller classes', () => {
    render(<Classic.Table aria-label="Nhật ký" className="text-xs"><tbody><tr><td>1</td></tr></tbody></Classic.Table>);
    const table = screen.getByRole('table', { name: 'Nhật ký' });
    expect(table.getAttribute('class')).toBe(`${TABLE} text-xs`);
    expect(table.parentElement?.getAttribute('class')).toBe(TABLE_WRAPPER);
  });

  it('keeps the Textarea and Checkbox classes and display names', () => {
    render(<><Classic.Textarea aria-label="Ghi chú" /><Classic.Checkbox aria-label="Đồng ý" /></>);
    expect(screen.getByRole('textbox', { name: 'Ghi chú' }).getAttribute('class')).toBe(TEXTAREA);
    const checkbox = screen.getByRole('checkbox', { name: 'Đồng ý' });
    expect(checkbox.getAttribute('class')).toBe(CHECKBOX);
    expect(checkbox).toHaveAttribute('type', 'checkbox');
    expect(Classic.Textarea.displayName).toBe('Textarea');
    expect(Classic.Checkbox.displayName).toBe('Checkbox');
  });

  it('re-exports the bare Radix tabs and radio group parts', () => {
    expect(Classic.Tabs).toBe(TabsPrimitive.Root);
    expect(Classic.TabsList).toBe(TabsPrimitive.List);
    expect(Classic.TabsTrigger).toBe(TabsPrimitive.Trigger);
    expect(Classic.TabsContent).toBe(TabsPrimitive.Content);
    expect(Classic.RadioGroup).toBe(RadioGroupPrimitive.Root);
    expect(Classic.RadioGroupItem).toBe(RadioGroupPrimitive.Item);
  });
});
