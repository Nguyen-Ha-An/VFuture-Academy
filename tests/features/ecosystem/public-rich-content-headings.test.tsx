// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RichContent } from '@/content-engine/schema/types';

vi.mock('next-intl', () => ({ useLocale: () => 'en' }));

import { StaticRichContent } from '@/features/ecosystem/ui/StaticRichContent';
import { publicRichContentHeadings } from '@/features/ecosystem/ui/public-rich-content';

const fixture: RichContent = {
  blocks: [
    { type: 'heading', id: 'overview', level: 1, align: 'center', content: [{ text: 'Overview', annotations: { bold: true } }] },
    { type: 'paragraph', id: 'intro', content: [{ text: 'A public introduction.' }] },
    { type: 'heading', id: 'existing-section', level: 2, content: [{ text: 'Existing section' }] },
    { type: 'callout', id: 'note', variant: 'note', blocks: [
      { type: 'heading', id: 'nested-title', level: 1, content: [{ text: 'Nested title' }] },
      { type: 'callout', id: 'tip', variant: 'tip', blocks: [
        { type: 'heading', id: 'deep-title', level: 1, content: [{ text: 'Deep title' }] },
        { type: 'heading', id: 'subsection', level: 3, content: [{ text: 'Subsection' }] },
        { type: 'heading', id: 'detail', level: 4, content: [{ text: 'Detail' }] },
      ] },
    ] },
  ],
};

afterEach(cleanup);

describe('public rich content headings', () => {
  it('copies only changed heading branches and preserves all other fields', () => {
    const result = publicRichContentHeadings(fixture);
    expect(result.blocks[0]).toEqual({ ...fixture.blocks[0], level: 2 });
    expect(result.blocks[1]).toBe(fixture.blocks[1]);
    expect(result.blocks[2]).toBe(fixture.blocks[2]);
    expect(result.blocks[3]).toMatchObject({ type: 'callout', id: 'note', variant: 'note' });
    expect(publicRichContentHeadings(result)).toBe(result);
  });

  it('keeps the page title as the only h1 and clamps nested author h1s to h2', () => {
    render(<><h1>Resource page title</h1><StaticRichContent content={fixture} publicContent /></>);
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['Resource page title']);
    for (const [name, id] of [['Overview', 'overview'], ['Existing section', 'existing-section'], ['Nested title', 'nested-title'], ['Deep title', 'deep-title']]) {
      expect(screen.getByRole('heading', { level: 2, name }).id).toBe(id);
    }
    expect(screen.getByRole('heading', { level: 3, name: 'Subsection' }).id).toBe('subsection');
    expect(screen.getByRole('heading', { level: 4, name: 'Detail' }).id).toBe('detail');
    expect(screen.getByText('A public introduction.')).toBeTruthy();
  });

  it('preserves the original payload and private rendering after rendering publicly', () => {
    const originalPayload = JSON.stringify(fixture);
    const privateBefore = renderToStaticMarkup(<StaticRichContent content={fixture} />);
    renderToStaticMarkup(<StaticRichContent content={fixture} publicContent />);
    expect(JSON.stringify(fixture)).toBe(originalPayload);
    expect(renderToStaticMarkup(<StaticRichContent content={fixture} publicContent={false} />)).toBe(privateBefore);
    expect(privateBefore.match(/<h1\b/g)).toHaveLength(3);
    expect(privateBefore).toContain('id="overview"');
  });
});
