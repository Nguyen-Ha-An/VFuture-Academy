import { describe, it, expect } from 'vitest';
import { RunsSchema, runsToPlainText } from '@/content-engine/schema/inline';
import { RichContentSchema, L10nRichContentSchema, ContentBlockSchema, CONTENT_BLOCK_TYPES } from '@/content-engine/schema/rich-content';

const p = (text: string) => ({ type: 'paragraph', content: [{ text }] });

describe('runs', () => {
  it('accepts text runs with annotations and blank runs', () => {
    expect(RunsSchema.safeParse([{ text: 'a', annotations: { bold: true, link: { href: 'https://x.y' } } }, { blank: 'b1' }]).success).toBe(true);
  });
  it('rejects unknown annotations, http links and empty arrays', () => {
    expect(RunsSchema.safeParse([{ text: 'a', annotations: { blink: true } }]).success).toBe(false);
    expect(RunsSchema.safeParse([{ text: 'a', annotations: { link: { href: 'http://x.y' } } }]).success).toBe(false);
    expect(RunsSchema.safeParse([]).success).toBe(false);
  });
  it('accepts a locale map for the run text', () => {
    expect(RunsSchema.safeParse([{ text: { vi: 'Xin chào', en: 'Hello' } }]).success).toBe(true);
  });
  it('rejects unknown locales and empty locale maps', () => {
    expect(RunsSchema.safeParse([{ text: { fr: 'Bonjour' } }]).success).toBe(false);
    expect(RunsSchema.safeParse([{ text: {} }]).success).toBe(false);
  });
  it('resolves a locale-map text to plain text', () => {
    expect(runsToPlainText([{ text: { vi: 'a', en: 'b' } }, { blank: 'x' }])).toBe('a____');
    expect(runsToPlainText([{ text: { vi: 'a', en: 'b' } }], 'en')).toBe('b');
    expect(runsToPlainText([{ text: 'plain' }, { text: { vi: 'a' } }], 'en')).toBe('plaina');
  });
});

describe('content blocks', () => {
  it.each([
    p('hi'),
    { type: 'heading', level: 2, content: [{ text: 'H' }] },
    { type: 'list', ordered: true, items: [{ content: [{ text: 'one' }], items: [{ content: [{ text: 'nested' }] }] }] },
    { type: 'quote', content: [{ text: 'q' }], author: { vi: 'A', en: 'A' } },
    { type: 'image', src: { assetId: 'asset_1' }, alt: 'diagram', width: 'md' },
    { type: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc123' },
    { type: 'video', src: { url: 'https://storage.supabase.co/v/a.mp4' }, poster: { assetId: 'asset_2' } },
    { type: 'audio', src: { assetId: 'asset_3' } },
    { type: 'table', headers: [{ content: [{ text: 'A' }] }], rows: [[{ content: [{ text: '1' }] }]] },
    { type: 'code', language: 'python', code: 'print(1)', highlightLines: [1] },
    { type: 'divider' },
    { type: 'embed', url: 'https://docs.google.com/presentation/d/abc/embed', title: 'Slides' },
    { type: 'pdf', src: { assetId: 'asset_4' }, title: { vi: 'Tài liệu', en: 'Handout' } },
    { type: 'callout', variant: 'warning', title: 'Careful', blocks: [p('inside')] },
    { type: 'math', latex: 'x^2' },
  ])('accepts %j', (block) => {
    const r = ContentBlockSchema.safeParse(block);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it.each([
    { type: 'paragraph', text: 'legacy' },
    { type: 'heading', level: 5, content: [{ text: 'H' }] },
    { type: 'image', src: { assetId: 'a' } },
    { type: 'video', provider: 'tiktok', url: 'https://tiktok.com/x' },
    { type: 'embed', url: 'https://evil.example.com/x', title: 'no' },
    { type: 'callout', variant: 'loud', blocks: [p('x')] },
    { type: 'quiz', id: 'q', questions: [] },
    { type: 'unknown_block' },
  ])('rejects %j', (block) => expect(ContentBlockSchema.safeParse(block).success).toBe(false));

  it('nests callouts only as content (no activity inside RichContent)', () => {
    const nested = { type: 'callout', variant: 'info', blocks: [{ type: 'callout', variant: 'tip', blocks: [p('deep')] }] };
    expect(ContentBlockSchema.safeParse(nested).success).toBe(true);
  });

  it('RichContent and L10nRichContent', () => {
    expect(RichContentSchema.safeParse({ blocks: [p('a')] }).success).toBe(true);
    expect(RichContentSchema.safeParse({ blocks: [] }).success).toBe(false);
    expect(L10nRichContentSchema.safeParse({ vi: { blocks: [p('a')] }, en: { blocks: [p('b')] } }).success).toBe(true);
    expect(L10nRichContentSchema.safeParse({ vi: { blocks: [p('a')] }, blocks: [] }).success).toBe(false);
  });

  it('exports the type list', () => {
    expect(CONTENT_BLOCK_TYPES).toEqual(['paragraph', 'heading', 'list', 'quote', 'image', 'video', 'audio', 'table', 'code', 'divider', 'embed', 'pdf', 'callout', 'math', 'diagram']);
  });
});
