// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasProvider, CanvasSelect } from '@/features/canvas/ui';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

afterEach(cleanup);
const options = [{ value: 'school', label: 'School' }, { value: 'central', label: 'Central' }];

it('keeps pointer selection, focus and the first Escape inside the open modal', async () => {
  const user = userEvent.setup();
  const inputRef = vi.fn();
  function Form() {
    const [scope, setScope] = useState('school');
    return <CanvasProvider theme="light"><Dialog><DialogTrigger>New role</DialogTrigger><DialogContent aria-describedby={undefined}><DialogTitle>Create role</DialogTitle><CanvasSelect label="Scope" value={scope} onChange={setScope} options={options} inputRef={inputRef} /></DialogContent></Dialog></CanvasProvider>;
  }
  const view = render(<Form />);
  await user.click(screen.getByRole('button', { name: 'New role' }));
  const dialog = screen.getByRole('dialog', { name: 'Create role' });
  const input = screen.getByRole('combobox', { name: 'Scope' });
  expect(inputRef).toHaveBeenCalledWith(input);
  await user.click(input);
  const option = await screen.findByRole('option', { name: 'Central' });
  expect(dialog).toContainElement(option);
  await user.click(option);
  expect(input).toHaveValue('Central');
  expect(input).toHaveFocus();
  await user.click(input);
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 27 });
  fireEvent.keyUp(input, { key: 'Escape', keyCode: 27 });
  await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'));
  expect(dialog).toBeInTheDocument();
  expect(input).toHaveFocus();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'New role' })).toHaveFocus());
  view.unmount();
  expect(inputRef).toHaveBeenLastCalledWith(null);
});

it('preserves an explicit portal container and supports ordinary nonmodal selection', async () => {
  const user = userEvent.setup();
  function Form() {
    const mountRef = useRef<HTMLDivElement>(null);
    return <CanvasProvider theme="light"><div ref={mountRef} data-testid="explicit-options" /><CanvasSelect label="Explicit scope" options={options} mountNode={() => mountRef.current} /><CanvasSelect label="Ordinary scope" options={options} /></CanvasProvider>;
  }
  render(<Form />);
  await user.click(screen.getByRole('combobox', { name: 'Explicit scope' }));
  expect(screen.getByTestId('explicit-options')).toContainElement(await screen.findByRole('listbox'));
  await user.click(screen.getByRole('option', { name: 'Central' }));
  await user.click(screen.getByRole('combobox', { name: 'Ordinary scope' }));
  const option = await screen.findByRole('option', { name: 'Central' });
  expect(screen.getByTestId('explicit-options')).not.toContainElement(option);
  await user.click(option);
  expect(screen.getByRole('combobox', { name: 'Ordinary scope' })).toHaveValue('Central');
});
