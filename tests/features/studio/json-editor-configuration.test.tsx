// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import { COURSE_REF } from '@/content-engine/diagnostics';
const seen = vi.hoisted(() => [] as Array<{extensions: unknown; basicSetup: unknown; onChange: unknown}>);
vi.mock('@uiw/react-codemirror', () => ({ default: ({ extensions, basicSetup, onChange }: { extensions: unknown; basicSetup: unknown; onChange: unknown }) => { seen.push({ extensions, basicSetup, onChange }); return null; } }));
import { JsonEditor } from '@/features/studio/ui/JsonEditor';
afterEach(() => { cleanup(); seen.length = 0; });
it('does not rebuild the editor parser and theme when source diagnostics refresh', () => {
  const messages = {workspace:{editor:{accessibleName:'JSON {docId}',format:'Format',pasteReplace:'Paste'}}};
  const view = (source: string) => <NextIntlClientProvider locale="en" messages={messages}><JsonEditor source={source} docRef={COURSE_REF} diagnostics={[]} locale="en" saveState="idle" onChange={()=>{}} /></NextIntlClientProvider>;
  const rendered = render(view('{}'));
  const initial = seen.at(-1);
  rendered.rerender(view('{} '));
  expect(seen.at(-1)?.extensions).toBe(initial?.extensions);
  expect(seen.at(-1)?.basicSetup).toBe(initial?.basicSetup);
  expect(seen.at(-1)?.onChange).toBe(initial?.onChange);
});
