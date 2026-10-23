import { describe, it, expect, beforeAll, vi } from 'vitest';
vi.mock('shiki/bundle/web', () => ({ createHighlighter: () => new Promise(() => {}) })); // keep the <pre> fallback deterministic in jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { BlockList } from '@/content-engine/render/BlockList';
import { registerContentBlocks } from '@/content-engine/render/blocks';
import { youtubeEmbedUrl, vimeoEmbedUrl } from '@/content-engine/render/blocks/Video';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import type { LessonBlock } from '@/content-engine/schema/types';

const rt = createPreviewRuntime({ id: 'l', kind: 'lesson', checksum: '', renders: { vi: { kind: 'lesson', id: 'l', title: 'L', blocks: [] }, en: { kind: 'lesson', id: 'l', title: 'L', blocks: [] } }, grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [] } }, 'en');
const mount = (blocks: LessonBlock[]) => render(<BlockList blocks={blocks} runtime={rt} path="/blocks" depth={0} />);
beforeAll(() => registerContentBlocks());

describe('content blocks', () => {
  it('paragraph, heading levels, list, quote, divider', () => {
    mount([
      { type: 'paragraph', content: [{ text: 'Hello' }], align: 'center' },
      { type: 'heading', level: 2, content: [{ text: 'Title' }] },
      { type: 'list', ordered: true, items: [{ content: [{ text: 'one' }], items: [{ content: [{ text: 'nested' }] }] }] },
      { type: 'quote', content: [{ text: 'Wise' }], author: 'Someone' },
      { type: 'divider' },
    ] as LessonBlock[]);
    expect(screen.getByText('Hello').closest('p')).toHaveClass('text-center');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Title');
    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getByText('Someone')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });
  it('image with alt/caption, audio, pdf and table', () => {
    mount([
      { type: 'image', src: { url: 'https://images.unsplash.com/a.png' }, alt: 'A diagram', caption: 'Figure 1', width: 'sm' },
      { type: 'audio', src: { assetId: 'asset_1' }, label: 'Clip' },
      { type: 'pdf', src: { url: 'https://x.supabase.co/a.pdf' }, title: 'Handout' },
      { type: 'table', headers: [{ content: [{ text: 'H' }] }], rows: [[{ content: [{ text: 'c1' }] }]] },
    ] as LessonBlock[]);
    expect(screen.getByRole('img', { name: 'A diagram' })).toHaveAttribute('src', 'https://images.unsplash.com/a.png');
    expect(screen.getByText('Figure 1').tagName).toBe('FIGCAPTION');
    expect(document.querySelector('audio')).toHaveAttribute('src', 'preview://asset/asset_1');
    expect(document.querySelector('audio')).toHaveAttribute('aria-label', 'Clip');
    expect(screen.getByTitle('Handout')).toHaveAttribute('src', 'https://x.supabase.co/a.pdf#toolbar=0');
    expect(screen.getByRole('columnheader')).toHaveTextContent('H');
    expect(screen.getByRole('cell')).toHaveTextContent('c1');
  });
  it('video: mp4 and providers; embed with allowlisted host', () => {
    mount([
      { type: 'video', src: { url: 'https://x.supabase.co/v.mp4' }, caption: 'Demo' },
      { type: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc123', caption: 'AI introduction' },
      { type: 'embed', url: 'https://docs.google.com/presentation/d/abc/embed', title: 'Slides' },
    ] as LessonBlock[]);
    expect(document.querySelector('video')).toHaveAttribute('src', 'https://x.supabase.co/v.mp4');
    expect(screen.getByTitle('YouTube: AI introduction')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abc123');
    expect(screen.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc123');
    expect(screen.getByTitle('Slides')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    expect(youtubeEmbedUrl('https://youtu.be/xyz?t=3')).toBe('https://www.youtube-nocookie.com/embed/xyz');
    expect(vimeoEmbedUrl('https://vimeo.com/12345')).toBe('https://player.vimeo.com/video/12345');
  });
  it('replaces failed local image and video media without collapsing their reserved space', () => {
    mount([{ type: 'image', src: { url: 'https://images.example/missing.png' }, alt: 'Missing chart' }, { type: 'video', src: { url: 'https://media.example/missing.mp4' } }] as LessonBlock[]);
    fireEvent.error(screen.getByRole('img', { name: 'Missing chart' }));
    fireEvent.error(document.querySelector('video')!);
    expect(screen.getByRole('img', { name: /Missing chart.*This image is unavailable/i })).toHaveClass('aspect-video');
    expect(screen.getByText('This video is unavailable.')).toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
  });
  it('keeps the external provider watch link available without probing the iframe', () => {
    mount([{ type: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc123' }] as LessonBlock[]);
    expect(screen.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc123');
  });
  it('code renders a pre with fallback before Shiki loads, plus filename and copy button', () => {
    mount([{ type: 'code', language: 'python', code: 'print(1)', filename: 'main.py' }] as LessonBlock[]);
    expect(screen.getByText('main.py')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
    expect(document.querySelector('pre code')).toHaveTextContent('print(1)');
  });
  it('callout nests children and math is unavailable', () => {
    mount([{ type: 'callout', variant: 'warning', title: 'Careful', blocks: [{ type: 'paragraph', content: [{ text: 'inside' }] }, { type: 'math', latex: 'x' }] }] as LessonBlock[]);
    expect(screen.getByRole('note', { name: /Careful/ })).toBeInTheDocument();
    expect(screen.getByText('inside')).toBeInTheDocument();
    expect(document.querySelector('[data-unavailable="math"]')).toBeInTheDocument();
    expect(document.querySelector('[data-unavailable="math"]')).toHaveAttribute('lang', 'en');
  });
});
