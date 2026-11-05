// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { CanvasButton, CanvasCheckbox, CanvasProvider, CanvasSelect, CanvasTextInput } from '@/features/canvas/ui';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { StaffThemeMenu } from '@/features/staff-ui/ui/StaffThemeMenu';
import { applyWorkspaceTheme } from '@/features/workspace-ui/ui/ThemeSwitcher';
import { useTheme } from '@instructure/emotion';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

afterEach(cleanup);
function renderCanvas(children: React.ReactNode) { return render(<CanvasProvider theme="light">{children}</CanvasProvider>); }

it('renders actual InstUI controls with labels, values and native disabled semantics', async () => {
  function Form() {
    const [value, setValue] = useState('Course');
    const [checked, setChecked] = useState(false);
    return <><CanvasTextInput label="Course title" value={value} onChange={setValue} /><CanvasCheckbox label="Required" checked={checked} onChange={setChecked} /><CanvasButton disabled>Publish</CanvasButton></>;
  }
  const view = renderCanvas(<Form />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Course title' }), { target: { value: 'Updated course' } });
  expect(screen.getByRole('textbox', { name: 'Course title' })).toHaveValue('Updated course');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Required' }));
  expect(screen.getByRole('checkbox', { name: 'Required' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  expect(view.container.querySelector('[class*="textInput"]')).not.toBeNull();
});

it('composes a Radix trigger through a DOM ref and restores keyboard focus', async () => {
  const user = userEvent.setup();
  function Menu() {
    const ref = useRef<HTMLButtonElement>(null);
    return <DropdownMenu><DropdownMenuTrigger asChild><CanvasButton ref={ref} variant="outline">Actions</CanvasButton></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Export draft</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
  }
  renderCanvas(<Menu />);
  const trigger = screen.getByRole('button', { name: 'Actions' });
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('menuitem', { name: 'Export draft' })).toBeVisible();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
});

it('keeps InstUI select options keyboard accessible and reports the serialized value', async () => {
  const user = userEvent.setup();
  function Form() { const [value, setValue] = useState('en'); return <CanvasSelect label="Language" value={value} options={[{value:'en',label:'English'},{value:'vi',label:'Tiếng Việt'}]} onChange={setValue} />; }
  renderCanvas(<Form />);
  const select = screen.getByRole('combobox', { name: 'Language' });
  select.focus();
  await user.click(select);
  fireEvent.keyDown(select, { key: 'ArrowDown', keyCode: 40 });
  fireEvent.keyDown(select, { key: 'Enter', keyCode: 13 });
  expect(select).toHaveValue('Tiếng Việt');
});


it('updates the real provider and both live workspace surfaces from the account theme action', async () => {
  function ThemeReadout() { const theme = useTheme(); return <output aria-label="InstUI theme">{'key' in theme ? String(theme.key) : ''}</output>; }
  renderCanvas(<><div className="vf-workspace" /><div className="vf-staff" /><ThemeReadout /></>);
  expect(screen.getByLabelText('InstUI theme')).toHaveTextContent('light');
  act(() => applyWorkspaceTheme('dark'));
  expect(screen.getByLabelText('InstUI theme')).toHaveTextContent('dark');
  expect(document.querySelector('.vf-workspace')).toHaveAttribute('data-theme', 'dark');
  expect(document.querySelector('.vf-staff')).toHaveAttribute('data-theme', 'dark');
  act(() => applyWorkspaceTheme('light'));
  expect(screen.getByLabelText('InstUI theme')).toHaveTextContent('light');
});


it('follows the actual StaffThemeMenu action without a provider remount', async () => {
  const user = userEvent.setup();
  function ThemeReadout() { const theme = useTheme(); return <output aria-label="InstUI theme">{'key' in theme ? String(theme.key) : ''}</output>; }
  const localized = staffUiTestMessages(messages, 'en');
  renderCanvas(<NextIntlClientProvider locale="en" messages={localized}><div className="vf-staff" /><StaffThemeMenu theme="light" /><ThemeReadout /></NextIntlClientProvider>);
  await user.click(screen.getByRole('button', { name: 'Theme' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
  expect(screen.getByLabelText('InstUI theme')).toHaveTextContent('dark');
  expect(document.querySelector('.vf-staff')).toHaveAttribute('data-theme', 'dark');
});


it('keeps existing SVG and text button children aligned within the real InstUI control', () => {
  renderCanvas(<CanvasButton><svg data-testid="action-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M1 10h18" /></svg>Export</CanvasButton>);
  const icon = screen.getByTestId('action-icon');
  expect(icon.parentElement).toHaveStyle({ display: 'inline-flex', alignItems: 'center' });
  expect(screen.getByRole('button', { name: 'Export' })).toContainElement(icon);
});
