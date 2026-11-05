// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { CanvasProvider } from '@/features/canvas/ui';
import { StructuredContentEditor } from '@/features/studio/ui/VisualEditor';

afterEach(cleanup);
function Harness({ initial, kind = 'rich', disabled = false }: { initial: unknown; kind?: 'rich' | 'record'; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <CanvasProvider theme="light"><StructuredContentEditor value={value} onChange={setValue} locale="en" defaultLanguage="en" disabled={disabled} label="Document content" kind={kind} /><output aria-label="Canonical value">{JSON.stringify(value)}</output></CanvasProvider>;
}
function current() { return JSON.parse(screen.getByLabelText('Canonical value').textContent!); }

it('edits a bilingual rich-content run while preserving the other language, block ID and formatting', () => {
  const initial = { en: { blocks: [{ id: 'intro', type: 'paragraph', content: [{ text: { en: 'Read this', vi: 'Hãy đọc' }, annotations: { bold: true } }] }] }, vi: { blocks: [{ type: 'paragraph', content: [{ text: 'Nội dung tiếng Việt' }] }] } };
  render(<Harness initial={initial} />);
  expect(screen.getByRole('combobox', { name: 'Content 1: Format' })).toHaveValue('Text / Text formatting');
  fireEvent.change(screen.getByRole('textbox', { name: 'Text (EN)' }), { target: { value: 'Revised instruction' } });
  expect(current()).toEqual({ ...initial, en: { blocks: [{ ...initial.en.blocks[0], content: [{ text: { en: 'Revised instruction', vi: 'Hãy đọc' }, annotations: { bold: true } }] }] } });
  expect(screen.getByRole('textbox', { name: 'ID' })).toHaveAttribute('readonly');
});

it('preserves eligibility scalar/object/array values and permits a generic record key named id', () => {
  const initial = { minimumAge: 16, needsConsent: true, metadata: { id: 'old-id', note: null }, groups: ['science', 'arts'] };
  render(<Harness initial={initial} kind="record" />);
  fireEvent.change(screen.getByRole('textbox', { name: 'id' }), { target: { value: 'new-id' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'needsConsent' }));
  expect(current()).toEqual({ ...initial, needsConsent: false, metadata: { id: 'new-id', note: null } });
});

it('holds structured rich-content edits under a workflow lock', () => {
  render(<Harness disabled initial={{ blocks: [{ type: 'paragraph', content: [{ text: 'Locked source' }] }] }} />);
  expect(screen.getByRole('textbox', { name: 'Text (EN)' })).toBeDisabled();
  expect(current()).toEqual({ blocks: [{ type: 'paragraph', content: [{ text: 'Locked source' }] }] });
});
