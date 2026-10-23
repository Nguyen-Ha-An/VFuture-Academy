// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InboxIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import {
  DataCard,
  DataPagination,
  DataToolbar,
  EmptyState,
  RowActions,
  SortableHead,
  ViewToggle,
  nextSort,
  pageWindow,
  type SortState,
} from "@/features/staff-ui/components";
import en from "@/messages/en.json";
import viMessages from "@/messages/vi.json";
import { staffUiTestMessages } from "@/messages/staff-ui";

const nav = vi.hoisted(() => ({
  pathname: "/admin/users",
  search: "",
  replace: vi.fn(),
  push: vi.fn(),
  useRouter: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => {
    nav.useRouter();
    return { replace: nav.replace, push: nav.push, refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() };
  },
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= function scrollIntoView() {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  nav.pathname = "/admin/users";
  nav.search = "";
  nav.replace.mockReset();
  nav.useRouter.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderKit(node: React.ReactNode, locale: "en" | "vi" = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={staffUiTestMessages(locale === "en" ? en : viMessages, locale)}>
      {node}
    </NextIntlClientProvider>,
  );
}

function lastReplace() {
  expect(nav.replace).toHaveBeenCalled();
  const [url, options] = nav.replace.mock.calls.at(-1)!;
  return { url: String(url), options };
}

describe("DataPagination", () => {
  it("page mode: nav landmark, a–b of N, numbered pages and callbacks", () => {
    const onPageChange = vi.fn();
    renderKit(<DataPagination mode="page" page={2} pageSize={10} total={45} onPageChange={onPageChange} />);
    const navEl = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(navEl).getByText("Showing 11–20 of 45")).toHaveClass("tabular-nums");
    expect(within(navEl).getByRole("button", { name: "Go to page 2" })).toHaveAttribute("aria-current", "page");
    expect(within(navEl).getAllByRole("button", { name: /Go to page/ })).toHaveLength(5);
    fireEvent.click(within(navEl).getByRole("button", { name: "Go to page 5" }));
    fireEvent.click(within(navEl).getByRole("button", { name: "Previous" }));
    fireEvent.click(within(navEl).getByRole("button", { name: "Next" }));
    expect(onPageChange.mock.calls).toEqual([[5], [1], [3]]);
  });

  it("page mode: disables the ends, clamps, and says No results for an empty list", () => {
    const { unmount } = renderKit(<DataPagination mode="page" page={9} pageSize={20} total={40} onPageChange={() => {}} />);
    expect(screen.getByText("Showing 21–40 of 40")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    unmount();
    renderKit(<DataPagination mode="page" page={1} pageSize={20} total={0} onPageChange={() => {}} />);
    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Go to page/ })).toBeNull();
  });

  it("page mode without callbacks links to the page param in the current URL", () => {
    nav.search = "q=lan&page=2";
    renderKit(<DataPagination mode="page" page={2} pageSize={10} total={30} />);
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/admin/users?q=lan");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/admin/users?q=lan&page=3");
    expect(screen.getByRole("link", { name: "Go to page 3" })).toHaveAttribute("href", "/admin/users?q=lan&page=3");
    expect(screen.getByRole("button", { name: "Go to page 2" })).toHaveAttribute("aria-current", "page");
  });

  it("hasMore mode shows Page n without a total, with explicit hrefs or page links", () => {
    const { unmount } = renderKit(<DataPagination mode="hasMore" page={3} hasMore={false} hrefForPage={(page) => `/admin/audit?page=${page}`} />);
    const navEl = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(navEl).getByText("Page 3")).toBeInTheDocument();
    expect(navEl.textContent).not.toMatch(/of|Showing/);
    expect(within(navEl).getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/admin/audit?page=2");
    expect(within(navEl).getByRole("button", { name: "Next" })).toBeDisabled();
    expect(within(navEl).queryByRole("button", { name: /Go to page/ })).toBeNull();
    unmount();
    renderKit(<DataPagination mode="hasMore" page={1} hasMore previousHref={null} nextHref="/admin/audit?cursor=abc" />);
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/admin/audit?cursor=abc");
  });

  it("loadMore mode is a single button with a loading state, hidden at the end", () => {
    const onLoadMore = vi.fn();
    const { rerender } = renderKit(<DataPagination mode="loadMore" hasMore onLoadMore={onLoadMore} />);
    const navEl = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(navEl).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(navEl).getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    rerender(
      <NextIntlClientProvider locale="en" messages={staffUiTestMessages(en, "en")}>
        <DataPagination mode="loadMore" hasMore loading onLoadMore={onLoadMore} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Loading…" })).toBeDisabled();
    rerender(
      <NextIntlClientProvider locale="en" messages={staffUiTestMessages(en, "en")}>
        <DataPagination mode="loadMore" hasMore={false} onLoadMore={onLoadMore} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("rows per page: callback, or URL param that resets the page", () => {
    const onPageSizeChange = vi.fn();
    const { unmount } = renderKit(
      <DataPagination mode="page" page={1} pageSize={25} total={100} pageSizeOptions={[10, 25, 50]} onPageChange={() => {}} onPageSizeChange={onPageSizeChange} />,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "50" } });
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
    unmount();
    nav.search = "status=active&page=3";
    renderKit(<DataPagination mode="page" page={3} pageSize={25} total={100} pageSizeOptions={[10, 25, 50]} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "10" } });
    expect(lastReplace()).toEqual({ url: "/admin/users?status=active&pageSize=10", options: { scroll: false } });
  });

  it("uses Vietnamese chrome strings", () => {
    renderKit(<DataPagination mode="page" page={1} pageSize={10} total={12} onPageChange={() => {}} />, "vi");
    expect(screen.getByRole("navigation", { name: "Phân trang" })).toBeInTheDocument();
    expect(screen.getByText("Hiển thị 1–10 trên 12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tiếp" })).toBeEnabled();
  });

  it("windows long page lists without hiding a single page behind a gap", () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageWindow(1, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageWindow(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageWindow(20, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
  });
});

describe("SortableHead", () => {
  function SortableTable() {
    const [sort, setSort] = useState<SortState>(null);
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead column="name" sort={sort} onSortChange={setSort}>
              Name
            </SortableHead>
            <SortableHead column="joined" sort={sort} onSortChange={setSort} defaultDirection="desc">
              Joined
            </SortableHead>
          </TableRow>
        </TableHeader>
      </Table>
    );
  }

  it("cycles aria-sort none → ascending → descending → none in callback mode", () => {
    renderKit(<SortableTable />);
    const [name, joined] = screen.getAllByRole("columnheader");
    const button = within(name).getByRole("button", { name: "Name" });
    expect(name).toHaveAttribute("aria-sort", "none");
    fireEvent.click(button);
    expect(name).toHaveAttribute("aria-sort", "ascending");
    expect(joined).toHaveAttribute("aria-sort", "none");
    fireEvent.click(button);
    expect(name).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(button);
    expect(name).toHaveAttribute("aria-sort", "none");
    fireEvent.click(within(joined).getByRole("button", { name: "Joined" }));
    expect(joined).toHaveAttribute("aria-sort", "descending");
    expect(nav.useRouter).not.toHaveBeenCalled();
  });

  it("reads and writes sort/dir URL params and resets paging", () => {
    nav.search = "sort=name&dir=desc&page=4&q=an";
    renderKit(
      <table>
        <thead>
          <tr>
            <SortableHead column="name">Name</SortableHead>
            <SortableHead column="email">Email</SortableHead>
          </tr>
        </thead>
      </table>,
    );
    const [name, email] = screen.getAllByRole("columnheader");
    expect(name).toHaveAttribute("aria-sort", "descending");
    expect(email).toHaveAttribute("aria-sort", "none");
    fireEvent.click(within(name).getByRole("button"));
    expect(lastReplace().url).toBe("/admin/users?q=an");
    fireEvent.click(within(email).getByRole("button"));
    expect(lastReplace().url).toBe("/admin/users?sort=email&dir=asc&q=an");
  });

  it("nextSort keeps a column sorted when unsorted is not allowed", () => {
    expect(nextSort({ column: "a", direction: "desc" }, "a", "asc", false)).toEqual({ column: "a", direction: "asc" });
    expect(nextSort({ column: "a", direction: "asc" }, "b")).toEqual({ column: "b", direction: "asc" });
  });
});

describe("DataToolbar", () => {
  const filters = [
    {
      param: "status",
      label: "Status",
      options: [
        { value: "active", label: "Active" },
        { value: "suspended", label: "Suspended" },
      ],
    },
  ];

  it("debounces search into the URL, keeps other params and resets paging", () => {
    vi.useFakeTimers();
    nav.search = "status=active&page=3";
    renderKit(<DataToolbar filters={filters} />);
    const search = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(search, { target: { value: "l" } });
    fireEvent.change(search, { target: { value: "lan" } });
    act(() => vi.advanceTimersByTime(249));
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(lastReplace()).toEqual({ url: "/admin/users?status=active&q=lan", options: { scroll: false } });
    expect(search).toHaveValue("lan");
  });

  it("does not rewrite the URL for whitespace-only edits and flushes on Enter", () => {
    vi.useFakeTimers();
    nav.search = "q=lan&page=2";
    renderKit(<DataToolbar />);
    const search = screen.getByRole("searchbox", { name: "Search" });
    expect(search).toHaveValue("lan");
    fireEvent.change(search, { target: { value: "lan " } });
    act(() => vi.advanceTimersByTime(300));
    expect(nav.replace).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: "lan anh" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(lastReplace().url).toBe("/admin/users?q=lan+anh");
    act(() => vi.advanceTimersByTime(300));
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it("writes native-select filters immediately and clears everything with Clear filters", () => {
    nav.search = "q=lan&status=active&view=grid&page=2";
    renderKit(<DataToolbar filters={filters} viewToggle />);
    const status = screen.getByRole("combobox", { name: "Status" });
    expect(status).toHaveValue("active");
    expect(within(status).getAllByRole("option").map((option) => option.textContent)).toEqual(["All", "Active", "Suspended"]);
    fireEvent.change(status, { target: { value: "suspended" } });
    expect(lastReplace().url).toBe("/admin/users?q=lan&status=suspended&view=grid");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(lastReplace().url).toBe("/admin/users?view=grid");
  });

  it("hides Clear filters when nothing is set and persists the view toggle without resetting paging", () => {
    nav.search = "page=2";
    renderKit(<DataToolbar filters={filters} viewToggle actions={<button type="button">Export</button>} />);
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "View" });
    expect(within(group).getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Grid" }));
    expect(lastReplace().url).toBe("/admin/users?page=2&view=grid");
  });

  it("works fully controlled without the router", () => {
    vi.useFakeTimers();
    function Controlled({ onChange }: { onChange: (next: Record<string, string>) => void }) {
      const [values, setValues] = useState<Record<string, string>>({ status: "" });
      return (
        <DataToolbar
          values={values}
          onValuesChange={(next) => {
            onChange(next);
            setValues(next);
          }}
          filters={filters}
          viewToggle
        />
      );
    }
    const onChange = vi.fn();
    renderKit(<Controlled onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "active" } });
    expect(onChange).toHaveBeenLastCalledWith({ status: "active" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: "an" } });
    act(() => vi.advanceTimersByTime(250));
    expect(onChange).toHaveBeenLastCalledWith({ status: "active", q: "an" });
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(onChange).toHaveBeenLastCalledWith({ status: "active", q: "an", view: "grid" });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onChange).toHaveBeenLastCalledWith({ status: "", q: "", view: "grid" });
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("");
    expect(nav.useRouter).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("names the search region and uses Vietnamese defaults", () => {
    renderKit(<DataToolbar filters={filters} />, "vi");
    expect(screen.getByRole("search", { name: "Công cụ lọc" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Tìm kiếm" })).toHaveAttribute("placeholder", "Tìm kiếm…");
    expect(screen.getByRole("option", { name: "Tất cả" })).toBeInTheDocument();
  });
});

describe("ViewToggle", () => {
  it("reports aria-pressed and accepts label overrides", () => {
    const onValueChange = vi.fn();
    renderKit(<ViewToggle value="grid" onValueChange={onValueChange} label="Layout" optionLabels={{ list: "Table" }} />);
    const group = screen.getByRole("group", { name: "Layout" });
    expect(within(group).getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Grid" }));
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.click(within(group).getByRole("button", { name: "Table" }));
    expect(onValueChange).toHaveBeenCalledWith("list");
  });
});

describe("RowActions", () => {
  function openMenu(name = "Actions for Lan") {
    fireEvent.pointerDown(screen.getByRole("button", { name }), { button: 0, ctrlKey: false });
  }

  it("asks for confirmation before a destructive action and runs it only on confirm", () => {
    const revoke = vi.fn();
    const copy = vi.fn();
    renderKit(
      <RowActions
        label="Actions for Lan"
        items={[
          { label: "View profile", href: "/admin/users/1" },
          { label: "Copy email", onSelect: copy },
          { label: "Revoke", destructive: true, onSelect: revoke, confirm: { title: "Revoke invitation?", description: "The link stops working.", confirmLabel: "Revoke invitation" } },
        ]}
      />,
    );
    openMenu();
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "View profile" })).toHaveAttribute("href", "/admin/users/1");
    expect(within(menu).getAllByRole("separator")).toHaveLength(1);
    expect(within(menu).getByRole("menuitem", { name: "Revoke" })).toHaveAttribute("data-variant", "destructive");

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy email" }));
    expect(copy).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Revoke" }));
    let dialog = screen.getByRole("dialog", { name: "Revoke invitation?" });
    expect(within(dialog).getByText("The link stops working.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Revoke" }));
    dialog = screen.getByRole("dialog", { name: "Revoke invitation?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke invitation" }));
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("defaults its trigger name and renders nothing without items", () => {
    const { container } = renderKit(
      <>
        <RowActions items={[{ label: "Open", href: "/x" }]} />
        <RowActions items={[]} label="Empty" />
      </>,
      "vi",
    );
    expect(screen.getByRole("button", { name: "Thao tác" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Empty" })).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});

describe("DataCard and EmptyState", () => {
  it("DataCard is a section named by its title with toolbar, table and footer slots", () => {
    renderKit(
      <DataCard title="Members" description="Everyone in this school" actions={<button type="button">Invite</button>} toolbar={<div>toolbar slot</div>} footer={<div>footer slot</div>}>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Lan</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </DataCard>,
    );
    const section = screen.getByRole("region", { name: "Members" });
    expect(within(section).getByRole("heading", { level: 2, name: "Members" })).toBeInTheDocument();
    expect(within(section).getByText("Everyone in this school")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Invite" })).toBeInTheDocument();
    expect(within(section).getByText("toolbar slot")).toBeInTheDocument();
    expect(within(section).getByRole("cell", { name: "Lan" })).toBeInTheDocument();
    expect(within(section).getByText("footer slot")).toBeInTheDocument();
    expect(section.innerHTML).not.toMatch(/shadow/);
  });

  it("DataCard without a title takes an aria-label", () => {
    renderKit(<DataCard aria-label="Invitations">rows</DataCard>);
    expect(screen.getByRole("region", { name: "Invitations" })).toHaveTextContent("rows");
  });

  it("EmptyState renders a dashed card with a decorative icon, heading, description and action", () => {
    const { container } = renderKit(
      <EmptyState icon={<InboxIcon />} title="No invitations yet" description="Invite a teacher to get started." action={<button type="button">Invite member</button>} />,
    );
    const root = container.querySelector("[data-slot=empty-state]")!;
    expect(root).toHaveClass("border-dashed");
    expect(screen.getByRole("heading", { level: 3, name: "No invitations yet" })).toBeInTheDocument();
    expect(screen.getByText("Invite a teacher to get started.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite member" })).toBeInTheDocument();
    expect(root.querySelector("svg")!.closest("[aria-hidden=true]")).not.toBeNull();
  });
});
