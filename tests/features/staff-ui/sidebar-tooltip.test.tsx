// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Sidebar, SidebarContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from '@/components/ui/sidebar';

/**
 * A rail tooltip that is hidden (expanded rail, mobile drawer) must not mount at all: a mounted
 * but hidden tooltip is still Radix's top dismissable layer, so the drawer's first Escape went to
 * it and the drawer stayed open (found by the harness e2e, tests/e2e/studio-harness/staff-ui-support.ts).
 */
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

function Rail({ open }: { open: boolean }) {
  return (
    <SidebarProvider open={open}>
      <Sidebar collapsible="icon" mobileTitle="Điều hướng" mobileDescription="Các khu vực">
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Thành viên"><a href="#users">Thành viên</a></SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}

describe('SidebarMenuButton tooltip', () => {
  it('never mounts while the rail is expanded, even on keyboard focus', async () => {
    render(<Rail open />);
    await act(async () => { fireEvent.focus(screen.getByRole('link', { name: 'Thành viên' })); });
    expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows the label on focus in the collapsed rail', async () => {
    render(<Rail open={false} />);
    await act(async () => { fireEvent.focus(screen.getByRole('link', { name: 'Thành viên' })); });
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Thành viên');
  });
});
