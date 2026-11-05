// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasProvider } from '@/features/canvas/ui/CanvasProvider';
import { applyWorkspaceTheme } from '@/features/workspace-ui/ui/ThemeSwitcher';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import * as RawDialog from '@/components/ui/workspace-dialog-primitive';

function Confirmation() {
  return <Dialog open><DialogContent><DialogTitle>Confirm action</DialogTitle><DialogDescription>Review this action.</DialogDescription><button>Continue</button></DialogContent></Dialog>;
}

afterEach(() => { cleanup(); document.cookie = 'vf-theme=; max-age=0; path=/'; });

describe('owning Canvas palette across portals', () => {
  it('carries live light/dark preference into the existing confirmation portal', async () => {
    render(<CanvasProvider theme="dark"><Confirmation /></CanvasProvider>);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm action' });
    expect(dialog).toHaveAttribute('data-canvas-surface', 'dark');
    act(() => applyWorkspaceTheme('light'));
    await waitFor(() => expect(dialog).toHaveAttribute('data-canvas-surface', 'light'));
  });

  it('bridges active row action menus without adding another dialog or changing menu semantics', async () => {
    render(<CanvasProvider theme="dark"><DropdownMenu defaultOpen><DropdownMenuTrigger>Actions</DropdownMenuTrigger><DropdownMenuContent aria-label="Row actions"><DropdownMenuItem>Edit record</DropdownMenuItem></DropdownMenuContent></DropdownMenu></CanvasProvider>);
    // Radix names the menu from its trigger via aria-labelledby, ahead of aria-label.
    const menu = await screen.findByRole('menu', { name: 'Actions' });
    expect(menu).toHaveAttribute('data-canvas-surface', 'dark');
    const triggerId = menu.getAttribute('aria-labelledby');
    const trigger = triggerId ? document.getElementById(triggerId) : null;
    expect(trigger).toHaveTextContent('Actions');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(screen.getByRole('menuitem', { name: 'Edit record' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('carries the same palette through raw learner and notebook confirmation primitives', async () => {
    render(<CanvasProvider theme="dark"><RawDialog.Root open><RawDialog.Portal><RawDialog.Content><RawDialog.Title>Leave editor</RawDialog.Title><RawDialog.Description>Keep your changes before leaving.</RawDialog.Description><button>Stay</button></RawDialog.Content></RawDialog.Portal></RawDialog.Root></CanvasProvider>);
    expect(await screen.findByRole('dialog', { name: 'Leave editor' })).toHaveAttribute('data-canvas-surface', 'dark');
  });

  it('leaves public/auth consumers outside Canvas without an override', async () => {
    render(<Confirmation />);
    expect(await screen.findByRole('dialog', { name: 'Confirm action' })).not.toHaveAttribute('data-canvas-surface');
  });
});
