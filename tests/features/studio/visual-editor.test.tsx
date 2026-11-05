// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import { itemRef } from '@/content-engine/diagnostics';
import { VisualEditor } from '@/features/studio/ui/VisualEditor';
import { visualSourceChange } from '@/features/studio/visual-authoring';

afterEach(cleanup);
const initial = { schemaVersion: 1, kind: 'lesson', id: 'intro', title: { en: 'Welcome', vi: 'Xin chào' }, blocks: [{ id: 'p1', type: 'paragraph', content: [{ text: { en: 'Read this', vi: 'Hãy đọc' }, annotations: { bold: true } }] }] };
function Harness({ readOnly = false }: { readOnly?: boolean }) {
  const [source, setSource] = useState(JSON.stringify(initial));
  return <><VisualEditor source={source} docRef={itemRef('intro')} locale="en" defaultLanguage="en" readOnly={readOnly} onChange={(value, expected) => setSource(current => visualSourceChange(current, expected, itemRef('intro'), value) ?? current)} /><output aria-label="Source">{source}</output></>;
}
it('edits inline bilingual text through the same raw document without losing annotations or the other language', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Text (EN)' }), { target: { value: 'Updated text' } });
  const next = JSON.parse(screen.getByLabelText('Source').textContent!);
  expect(next.blocks[0]).toEqual({ ...initial.blocks[0], content: [{ text: { en: 'Updated text', vi: 'Hãy đọc' }, annotations: { bold: true } }] });
  await user.click(screen.getByRole('combobox', { name: 'Editing language' }));
  await user.click(screen.getByRole('option', { name: 'Tiếng Việt' }));
  expect(screen.getByRole('textbox', { name: 'Text (VI)' })).toHaveValue('Hãy đọc');
  fireEvent.change(screen.getByRole('textbox', { name: 'Text (VI)' }), { target: { value: 'Bản đã sửa' } });
  const bilingual = JSON.parse(screen.getByLabelText('Source').textContent!);
  expect(bilingual.blocks[0]).toEqual({ ...initial.blocks[0], content: [{ text: { en: 'Updated text', vi: 'Bản đã sửa' }, annotations: { bold: true } }] });
});
it('adds and reorders blocks with stable existing ids', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByText('Add a block', { selector: 'summary' }));
  await user.click(screen.getByRole('combobox', { name: 'Add a block: Format' }));
  await user.click(screen.getByRole('option', { name: 'Heading' }));
  expect(screen.getByRole('combobox', { name: 'Add a block: Format' })).toHaveValue('Heading');
  expect(JSON.parse(screen.getByLabelText('Source').textContent!).blocks).toEqual(initial.blocks);
  fireEvent.click(screen.getByRole('button', { name: 'Add a block' }));
  const next = JSON.parse(screen.getByLabelText('Source').textContent!);
  expect(next.blocks).toHaveLength(2);
  expect(next.blocks[0]).toEqual(initial.blocks[0]);
  expect(next.blocks[1].type).toBe('heading');
  const addedBlock = next.blocks[1];
  fireEvent.click(screen.getByRole('button', { name: 'Move up' }));
  const moved = JSON.parse(screen.getByLabelText('Source').textContent!);
  expect(moved.blocks[1]).toEqual(initial.blocks[0]);
  expect(moved.blocks[0]).toEqual(addedBlock);
  expect(moved.id).toBe(initial.id);
  expect((screen.getByRole('combobox', { name: /^Learning canvas/ }) as HTMLInputElement).value).toMatch(/^1\. Heading/);
});
it('respects workflow locks throughout the palette and inspector', () => {
  render(<Harness readOnly />);
  expect(screen.getByRole('button', { name: 'Add a block' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
});

it('renders bank question fields from the exact question union without an invented document envelope', () => {
  const bankQuestion = { id: 'q1', type: 'true_false', content: { blocks: [{ type: 'paragraph', content: [{ text: 'Is this correct?' }] }] }, correctAnswer: true };
  const onChange = (value: unknown) => { expect(value).toEqual({ ...bankQuestion, correctAnswer: false }); };
  render(<VisualEditor question source={JSON.stringify(bankQuestion)} docRef={itemRef('q1')} locale="en" defaultLanguage="en" readOnly={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Answer key' }));
});
