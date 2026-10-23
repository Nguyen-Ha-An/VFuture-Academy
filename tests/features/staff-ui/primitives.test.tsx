// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import ts from "typescript";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const UI_DIR = join(process.cwd(), "src/components/ui");
// classic.tsx is the frozen copy of the old primitives; page.tsx holds the
// learner/public page helpers. Neither is a canonical shadcn primitive.
const NON_CANONICAL = new Set(["classic.tsx", "page.tsx"]);
const canonicalFiles = readdirSync(UI_DIR).filter((file) => file.endsWith(".tsx") && !NON_CANONICAL.has(file));

beforeAll(() => {
  // cmdk measures its list and scrolls the active item into view.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Button", () => {
  it("defaults to the primary 36px variant and type=button", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("bg-primary", "text-primary-foreground", "h-9", "rounded-md");
  });

  it("maps variants and sizes", () => {
    render(
      <>
        <Button variant="outline" size="sm">Outline</Button>
        <Button variant="destructive" size="lg">Delete</Button>
        <Button variant="ghost" size="icon" aria-label="More" />
        <Button variant="secondary" size="icon-sm" aria-label="Less" />
        <Button variant="link">Link</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Outline" })).toHaveClass("border", "border-input", "h-8");
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("bg-destructive", "h-10");
    expect(screen.getByRole("button", { name: "More" })).toHaveClass("size-9");
    expect(screen.getByRole("button", { name: "Less" })).toHaveClass("bg-secondary", "size-8");
    expect(screen.getByRole("button", { name: "Link" })).toHaveClass("underline-offset-4");
  });

  it("keeps an explicit type and lets caller classes win", () => {
    render(<Button type="submit" className="bg-background px-2">Submit</Button>);
    const button = screen.getByRole("button", { name: "Submit" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveClass("bg-background", "px-2");
    expect(button).not.toHaveClass("bg-primary", "px-4");
  });

  it("renders its child with asChild and adds no button type", () => {
    render(<Button asChild variant="outline"><a href="/studio">Open studio</a></Button>);
    const link = screen.getByRole("link", { name: "Open studio" });
    expect(link.tagName).toBe("A");
    expect(link).not.toHaveAttribute("type");
    expect(link).toHaveClass("border-input");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Badge", () => {
  it.each([
    ["default", "bg-primary"],
    ["secondary", "bg-secondary"],
    ["outline", "border-border"],
    ["destructive", "bg-destructive"],
    ["success", "bg-success"],
    ["info", "bg-info"],
    ["warning", "bg-warning"],
    ["danger", "bg-destructive/10"],
    ["neutral", "bg-muted"],
  ] as const)("renders the %s tone", (variant, expected) => {
    render(<Badge variant={variant}>{variant}</Badge>);
    const badge = screen.getByText(variant);
    expect(badge.tagName).toBe("SPAN");
    expect(badge).toHaveClass(expected, "rounded-md", "text-xs", "font-semibold");
  });

  it("uses token-backed colours for the soft tones", () => {
    render(<Badge variant="success">Published</Badge>);
    expect(screen.getByText("Published")).toHaveClass("text-success-foreground", "border-success-border");
  });
});

describe("canonical primitive sources", () => {
  it("has no shadow utilities anywhere in src/components/ui", () => {
    expect(canonicalFiles.length).toBeGreaterThan(20);
    const offenders = canonicalFiles.filter((file) => /shadow/.test(readFileSync(join(UI_DIR, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("has no hard-coded English in the JSX of sidebar, dialog, sheet, breadcrumb and command", () => {
    const literals: string[] = [];
    const namedAttributes = new Set(["aria-label", "title", "placeholder", "alt", "aria-description"]);
    for (const file of ["sidebar.tsx", "dialog.tsx", "sheet.tsx", "breadcrumb.tsx", "command.tsx"]) {
      const source = ts.createSourceFile(file, readFileSync(join(UI_DIR, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text)) literals.push(`${file}: ${node.text.trim()}`);
        if (ts.isJsxAttribute(node) && namedAttributes.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) {
          literals.push(`${file}: ${node.name.getText(source)}="${node.initializer.text}"`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(literals).toEqual([]);
  });
});

describe("Dialog and Sheet", () => {
  it("names the close button from closeLabel", () => {
    render(
      <Dialog open>
        <DialogContent closeLabel="Đóng">
          <DialogTitle>Invite</DialogTitle>
          <DialogDescription>Send an invitation</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Invite" });
    expect(within(dialog).getByRole("button", { name: "Đóng" })).toBeInTheDocument();
    expect(dialog.className).not.toMatch(/shadow/);
  });

  it("defaults the close label to English and marks the side", () => {
    render(
      <Sheet open>
        <SheetContent side="left">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Narrow the list</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(sheet).toHaveAttribute("data-side", "left");
    expect(within(sheet).getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

describe("Breadcrumb, Table and Progress", () => {
  it("labels the breadcrumb landmark from a prop", () => {
    const { rerender } = render(<Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbPage>Users</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>);
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    rerender(<Breadcrumb aria-label="Đường dẫn"><BreadcrumbList><BreadcrumbItem><BreadcrumbPage>Users</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>);
    expect(screen.getByRole("navigation", { name: "Đường dẫn" })).toBeInTheDocument();
    expect(screen.getByText("Users")).toHaveAttribute("aria-current", "page");
  });

  it("keeps the Table scroll wrapper and table attributes", () => {
    const { container } = render(
      <Table aria-label="Members" className="min-w-[40rem]">
        <TableHeader><TableRow><TableHead>Name</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableCell>An</TableCell></TableRow></TableBody>
      </Table>,
    );
    const table = screen.getByRole("table", { name: "Members" });
    expect(table).toHaveClass("w-full", "text-sm", "min-w-[40rem]");
    expect(container.firstElementChild).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("h-10");
  });

  it("exposes progress values and clamps them", () => {
    render(<><Progress aria-label="Readiness" value={4} max={6} /><Progress aria-label="Loading" /><Progress aria-label="Over" value={140} /></>);
    expect(screen.getByRole("progressbar", { name: "Readiness" })).toHaveAttribute("aria-valuenow", "4");
    expect(screen.getByRole("progressbar", { name: "Loading" })).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByRole("progressbar", { name: "Over" })).toHaveAttribute("aria-valuenow", "100");
  });
});

function StaffSidebar({ onOpenChange, open }: { onOpenChange?: (open: boolean) => void; open?: boolean }) {
  return (
    <SidebarProvider open={open} onOpenChange={onOpenChange}>
      <Sidebar collapsible="icon" mobileTitle="Điều hướng" mobileDescription="Các khu vực quản trị">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive tooltip="Users">
                  <a href="#users">Users</a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset data-testid="inset">
        <SidebarTrigger label="Thu gọn thanh bên" />
        <input aria-label="Search" />
        <div className="cm-editor"><div contentEditable suppressContentEditableWarning data-testid="code">{"{}"}</div></div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function sidebarState(container: HTMLElement) {
  return container.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state");
}

describe("Sidebar", () => {
  it("collapses from the trigger, reports the change and writes no cookie", () => {
    const onOpenChange = vi.fn();
    const cookieSetter = vi.spyOn(Document.prototype, "cookie", "set");
    const { container } = render(<StaffSidebar onOpenChange={onOpenChange} />);
    expect(sidebarState(container)).toBe("expanded");

    const trigger = screen.getByRole("button", { name: "Thu gọn thanh bên" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(trigger);

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(sidebarState(container)).toBe("collapsed");
    expect(container.querySelector('[data-slot="sidebar"]')).toHaveAttribute("data-collapsible", "icon");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(cookieSetter).not.toHaveBeenCalled();
  });

  it("stays on the controlled value until the caller updates it", () => {
    const onOpenChange = vi.fn();
    const { container } = render(<StaffSidebar open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn thanh bên" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(sidebarState(container)).toBe("expanded");
  });

  it("toggles on Cmd/Ctrl+B but not while typing", () => {
    const onOpenChange = vi.fn();
    const { container } = render(<StaffSidebar onOpenChange={onOpenChange} />);

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Search" }), { key: "b", metaKey: true });
    fireEvent.keyDown(screen.getByTestId("code"), { key: "b", ctrlKey: true });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(sidebarState(container)).toBe("expanded");

    fireEvent.keyDown(document.body, { key: "b", metaKey: true });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(document.body, { key: "B", ctrlKey: true });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(sidebarState(container)).toBe("expanded");
  });

  it("renders SidebarInset as a div and no main landmark", () => {
    render(<StaffSidebar />);
    expect(screen.getByTestId("inset").tagName).toBe("DIV");
    expect(screen.queryByRole("main")).toBeNull();
  });

  it("uses full-opacity muted text for group labels", () => {
    render(<StaffSidebar />);
    const label = screen.getByText("Workspace");
    expect(label).toHaveClass("text-muted-foreground");
    expect(label.className).not.toMatch(/\/70/);
  });

  it("opens the mobile sidebar as a named dialog", () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 });
    try {
      render(<StaffSidebar />);
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Thu gọn thanh bên" }));
      const drawer = screen.getByRole("dialog", { name: "Điều hướng" });
      expect(within(drawer).getByRole("link", { name: "Users" })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
    }
  });
});

describe("NativeSelect", () => {
  it("forwards select props so selectOptions works", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <label>
        Status
        <NativeSelect name="status" defaultValue="all" onChange={onChange}>
          <NativeSelectOption value="all">All</NativeSelectOption>
          <NativeSelectOption value="active">Active</NativeSelectOption>
        </NativeSelect>
      </label>,
    );
    const select = screen.getByRole("combobox", { name: "Status" });
    expect(select).toHaveClass("h-9", "appearance-none");
    await user.selectOptions(select, "active");
    expect(select).toHaveValue("active");
    expect(onChange).toHaveBeenCalledOnce();
  });
});

describe("Command", () => {
  it("filters items as the user types", async () => {
    const user = userEvent.setup();
    const view = render(
      <Command label="Go to">
        <CommandInput />
        <CommandList>
          <CommandEmpty>No results</CommandEmpty>
          <CommandItem>Create course</CommandItem>
          <CommandItem>Grade submissions</CommandItem>
        </CommandList>
      </Command>,
    );
    const input = within(view.container).getByRole("combobox", { name: "Go to" });

    await user.type(input, "grade");
    expect(within(view.container).getByRole("option", { name: "Grade submissions" })).toBeInTheDocument();
    expect(within(view.container).queryByRole("option", { name: "Create course" })).toBeNull();

    await user.clear(input);
    await user.type(input, "zzz");
    expect(within(view.container).queryAllByRole("option")).toHaveLength(0);
    expect(within(view.container).getByText("No results")).toBeInTheDocument();
  });
});
