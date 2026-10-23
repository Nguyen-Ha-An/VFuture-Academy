import { describe, it, expect, vi } from 'vitest';

const { createHighlighter } = vi.hoisted(() => ({ createHighlighter: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ codeToHtml: () => '<pre>ok</pre>' }) }));
vi.mock('shiki/bundle/web', () => ({ createHighlighter }));

import { CODE_THEMES, getHighlighter } from '@/content-engine/render/blocks/Code';

describe('getHighlighter', () => {
  it('retries after a rejected shiki import instead of caching the failure forever', async () => {
    await expect(getHighlighter()).rejects.toThrow('offline');
    const highlighter = await getHighlighter();
    expect(highlighter.codeToHtml('x', { lang: 'python', themes: CODE_THEMES, defaultColor: 'light' })).toBe('<pre>ok</pre>');
  });

  it('loads both GitHub themes so the dark workspace themes can switch colours', async () => {
    await getHighlighter();
    expect(CODE_THEMES).toEqual({ light: 'github-light', dark: 'github-dark' });
    expect(createHighlighter).toHaveBeenLastCalledWith(expect.objectContaining({ themes: ['github-light', 'github-dark'] }));
  });
});
