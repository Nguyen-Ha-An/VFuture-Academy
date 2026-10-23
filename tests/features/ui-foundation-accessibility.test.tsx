// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandDialog, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

type QuickAction = { label: string; value: string; onSelect?: () => void };

function QuickActions({ items }: { items: QuickAction[] }) {
  return (
    <Command label="Quick actions">
      <CommandInput />
      <CommandList>
        {items.map((item) => <CommandItem key={item.value} value={item.value} keywords={[item.label]} onSelect={item.onSelect}>{item.label}</CommandItem>)}
      </CommandList>
    </Command>
  );
}

// cmdk measures its list and scrolls the active item into view; jsdom has neither.
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

describe("UI foundation accessibility contracts", () => {
  it("registers the next-intl request configuration with Next", async () => {
    const config = await readFile("next.config.ts", "utf8");
    expect(config).toContain('createNextIntlPlugin("./src/i18n/request.ts")');
  });

  it("renders a named modal command palette, moves focus into it, and closes it on Escape", () => {
    const onOpenChange = vi.fn();
    render(<CommandDialog open onOpenChange={onOpenChange} title="Quick actions" description="Find a page or action"><CommandInput /><CommandList><CommandItem>Search courses</CommandItem></CommandList></CommandDialog>);
    const dialog = screen.getByRole("dialog", { name: "Quick actions" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(within(dialog).getByRole("combobox", { name: "Quick actions" })).toBe(document.activeElement);
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("gives checkbox controls a 24px minimum hit area", () => {
    render(<Checkbox aria-label="Accept policy" />);
    expect(screen.getByRole("checkbox", { name: "Accept policy" }).className).toContain("size-6");
  });

  it("supports keyboard selection in its searchable command list", () => {
    const onSelect = vi.fn();
    const view = render(<QuickActions items={[{ label: "Create course", value: "create" }, { label: "Search courses", value: "search", onSelect }]} />);
    const search = within(view.container).getByRole("combobox", { name: "Quick actions" });
    const firstOption = within(view.container).getByRole("option", { name: "Create course" });
    expect(firstOption.id).not.toBe("");
    // cmdk selects the first item on mount but only fills
    // aria-activedescendant once the selection moves.
    expect(firstOption.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const activeOption = within(view.container).getByRole("option", { name: "Search courses" });
    expect(activeOption.getAttribute("aria-selected")).toBe("true");
    expect(search.getAttribute("aria-activedescendant")).toBe(activeOption.id);
    expect(firstOption.getAttribute("aria-selected")).toBe("false");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("invokes a command item when a pointer user selects it", () => {
    const onSelect = vi.fn();
    const view = render(<QuickActions items={[{ label: "Create course", value: "create", onSelect }]} />);
    fireEvent.click(within(view.container).getByRole("option", { name: "Create course" }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("keeps each command option id stable when items are reordered", () => {
    const first = { label: "Create course", value: "create" };
    const second = { label: "Search courses", value: "search" };
    const view = render(<QuickActions items={[first, second]} />);
    const originalId = within(view.container).getByRole("option", { name: "Search courses" }).id;

    view.rerender(<QuickActions items={[second, first]} />);

    expect(within(view.container).getByRole("option", { name: "Search courses" }).id).toBe(originalId);
  });
});
