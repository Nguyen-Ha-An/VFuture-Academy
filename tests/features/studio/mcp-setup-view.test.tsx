// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { McpSetupView } from '@/features/studio/ui/McpSetupView';

const endpoint = 'https://academy.example/api/mcp';

function view(state: Parameters<typeof McpSetupView>[0]['state']) {
  return render(
    <NextIntlClientProvider locale="en" messages={staffUiTestMessages(en, 'en')}>
      <McpSetupView state={state} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe('Studio MCP setup', () => {
  it('shows the exact endpoint and lets a keyboard user copy it', async () => {
    const user = userEvent.setup();
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    view({ kind: 'enabled', endpoint });

    expect(screen.getByRole('heading', { level: 1, name: 'Add MCP' })).toBeInTheDocument();
    const url = screen.getByRole('textbox', { name: 'MCP server URL' });
    expect(url).toHaveValue(endpoint);
    expect(url).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'Claude Code command' }))
      .toHaveValue(`claude mcp add --transport http vfuture-studio ${endpoint}`);
    const button = screen.getByRole('button', { name: 'Copy server URL' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(copy).toHaveBeenCalledWith(endpoint);
    expect(button).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    expect(screen.queryByRole('link', { name: /authorize/i })).not.toBeInTheDocument();
  });

  it('explains disabled service without inviting a connection attempt', () => {
    view({ kind: 'disabled', endpoint });
    expect(screen.getByRole('textbox', { name: 'MCP server URL' })).toHaveValue(endpoint);
    expect(screen.getByText(/Connections are currently unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy server URL' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Claude Code command' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View connected apps' })).toHaveAttribute('href', '/account/connected-apps');
  });

  it('withholds the endpoint and steps when this account is excluded', () => {
    view({ kind: 'restricted' });
    expect(screen.getByText('Studio MCP is not available for this account.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'MCP server URL' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy server URL' })).not.toBeInTheDocument();
  });

  it('offers a keyboard-selectable URL when the Clipboard API fails', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    view({ kind: 'enabled', endpoint });
    await user.click(screen.getByRole('button', { name: 'Copy server URL' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Select and copy the URL above.');
    const url = screen.getByRole('textbox', { name: 'MCP server URL' });
    url.focus();
    expect(url).toHaveFocus();
    expect((url as HTMLInputElement).selectionStart).toBe(0);
    expect((url as HTMLInputElement).selectionEnd).toBe(endpoint.length);
  });
});
