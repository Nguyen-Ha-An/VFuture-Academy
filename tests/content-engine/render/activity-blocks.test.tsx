import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerContentBlocks, registerActivityBlocks } from '@/content-engine/render/blocks';
import { LessonRenderer } from '@/content-engine/render/LessonRenderer';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import type { CompiledItem } from '@/content-engine/compile';

const rc = (t: string) => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const p = (t: string) => ({ type: 'paragraph', content: [{ text: t }] });
const lesson = (blocks: unknown[]): CompiledItem => ({ id: 'l1', kind: 'lesson', checksum: '', renders: { en: { kind: 'lesson', id: 'l1', title: 'Lesson', objectives: ['Know things'], estimatedMinutes: 5, blocks } as never, vi: { kind: 'lesson', id: 'l1', title: 'Bài', blocks } as never }, grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [], lessonCompletionMode: 'view' } });
beforeAll(() => { registerContentBlocks(); registerActivityBlocks(); });

describe('LessonRenderer', () => {
  it('shows title, objectives, minutes and marks viewed', () => {
    const item = lesson([p('body')]);
    const rt = createPreviewRuntime(item, 'en');
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Lesson');
    expect(screen.getByText('Know things')).toBeInTheDocument();
    expect(screen.getByText(/5 min/)).toBeInTheDocument();
    expect(rt.snapshot().__viewed).toBe(true);
  });

  it('keeps lesson context without repeating the title when the page owns the heading', () => {
    const item = lesson([p('body')]);
    const rt = createPreviewRuntime(item, 'en');
    render(<LessonRenderer item={item.renders.en} runtime={rt} presentation hideTitle />);
    expect(screen.queryByRole('heading', { name: 'Lesson' })).not.toBeInTheDocument();
    expect(screen.getByText('Know things')).toBeInTheDocument();
    // The activity frame's head owns the mono meta line (minutes) and the width.
    expect(screen.queryByText('5 min')).not.toBeInTheDocument();
    expect(screen.getByRole('article')).not.toHaveClass('max-w-[760px]');
    expect(rt.snapshot().__viewed).toBe(true);
  });
});

describe('heading outline', () => {
  const h = (level: number, text: string) => ({ type: 'heading', level, content: [{ text }] });

  it('demotes an authored h1 below the page heading when the page owns the title', () => {
    const item = lesson([h(1, 'Intro'), p('body'), h(2, 'Details')]);
    render(<LessonRenderer item={item.renders.en} runtime={createPreviewRuntime(item, 'en')} presentation hideTitle />);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Intro' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Details' })).toBeInTheDocument();
  });

  it('keeps a lesson whose shallowest heading is h2 unchanged', () => {
    const item = lesson([h(2, 'Section'), h(3, 'Sub')]);
    render(<LessonRenderer item={item.renders.en} runtime={createPreviewRuntime(item, 'en')} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Sub' })).toBeInTheDocument();
  });

  it('puts container titles below the authored headings, found inside containers too', () => {
    const item = lesson([{ id: 'acc', type: 'accordion', items: [{ id: 'a1', title: 'More', blocks: [h(1, 'Nested')] }] }]);
    render(<LessonRenderer item={item.renders.en} runtime={createPreviewRuntime(item, 'en')} presentation hideTitle />);
    expect(screen.getByRole('heading', { level: 3, name: 'More' })).toBeInTheDocument();
  });

  it('gives container titles the level after the owner when there are no headings', () => {
    const item = lesson([{ id: 'acc', type: 'accordion', items: [{ id: 'a1', title: 'More', blocks: [p('hidden-a')] }] }]);
    render(<LessonRenderer item={item.renders.en} runtime={createPreviewRuntime(item, 'en')} presentation hideTitle />);
    expect(screen.getByRole('heading', { level: 2, name: 'More' })).toBeInTheDocument();
  });
});

describe('reflection', () => {
  it('saves text and completes when minChars met', async () => {
    const item = lesson([{ id: 'ref', type: 'reflection', prompt: rc('Think'), required: true, minChars: 5 }]);
    const rt = createPreviewRuntime(item, 'en');
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    await userEvent.type(screen.getByRole('textbox', { name: /Think/ }), 'Hello world');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(rt.getBlockState<{ text: string; completed?: boolean }>('ref')).toMatchObject({ text: 'Hello world', completed: true });
  });
});

describe('flashcards', () => {
  it('flips, advances, tracks seen and completes at the end', async () => {
    const item = lesson([{ id: 'fc', type: 'flashcards', cards: [{ id: 'c1', front: rc('Q1'), back: rc('A1') }, { id: 'c2', front: rc('Q2'), back: rc('A2') }] }]);
    const rt = createPreviewRuntime(item, 'en');
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    expect(screen.getByText('Q1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /flip/i }));
    expect(screen.getByText('A1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(screen.getByText('Q2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /flip/i }));
    await userEvent.click(screen.getByRole('button', { name: /review again/i }));
    expect(rt.getBlockState<{ seen: string[]; again: string[]; completed?: boolean }>('fc')).toMatchObject({ seen: ['c1', 'c2'], again: ['c2'], completed: true });
  });
});

describe('containers', () => {
  it('accordion toggles, tabs switch, reveal opens, stepper advances and completes', async () => {
    const item = lesson([
      { id: 'acc', type: 'accordion', items: [{ id: 'a1', title: 'More', blocks: [p('hidden-a')] }] },
      { id: 'tabs', type: 'tabs', items: [{ id: 't1', title: 'Tab 1', blocks: [p('tab-one')] }, { id: 't2', title: 'Tab 2', blocks: [p('tab-two')] }] },
      { id: 'rev', type: 'reveal', label: 'Show answer', blocks: [p('the-answer')] },
      { id: 'step', type: 'stepper', linear: true, steps: [{ id: 's1', title: 'First', blocks: [p('step-one')] }, { id: 's2', title: 'Second', blocks: [p('step-two')] }] },
    ]);
    const rt = createPreviewRuntime(item, 'en');
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    expect(screen.queryByText('hidden-a')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText('hidden-a')).toBeVisible();
    expect(screen.getByText('tab-one')).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Tab 2' }));
    expect(screen.getByText('tab-two')).toBeVisible();
    expect(screen.queryByText('the-answer')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(screen.getByText('the-answer')).toBeVisible();
    expect(screen.getByText('step-one')).toBeVisible();
    expect(screen.queryByText('step-two')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText('step-two')).toBeVisible();
    expect(rt.getBlockState<{ step: number; completed?: boolean }>('step')).toMatchObject({ step: 1, completed: true });
  });
});

describe('tabs keyboard contract', () => {
  it('moves selection with arrows, Home and End, keeps one tab stop, names the list and persists the choice', async () => {
    const item = lesson([{ id: 'tabs', type: 'tabs', items: [{ id: 't1', title: 'Tab 1', blocks: [p('tab-one')] }, { id: 't2', title: 'Tab 2', blocks: [p('tab-two')] }, { id: 't3', title: 'Tab 3', blocks: [p('tab-three')] }] }]);
    const rt = createPreviewRuntime(item, 'en');
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    expect(screen.getByRole('tablist', { name: 'Content tabs' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    // Radix roving focus: Tab enters on the selected tab, which is then the list's only tab stop.
    await userEvent.tab();
    expect(tabs[0]).toHaveFocus();
    expect(tabs.filter((t) => t.tabIndex === 0)).toEqual([tabs[0]]);
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('tab-two')).toBeVisible();
    expect(rt.getBlockState<{ active: string }>('tabs')).toEqual({ active: 't2' });
    await userEvent.keyboard('{End}');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(rt.getBlockState<{ active: string }>('tabs')).toEqual({ active: 't3' });
    await userEvent.keyboard('{Home}');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(tabs[2]).toHaveFocus();
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toEqual([tabs[2]]);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[2].id);
  });

  it('restores the persisted tab and localizes the list name', async () => {
    const item = lesson([{ id: 'tabs', type: 'tabs', items: [{ id: 't1', title: 'Một', blocks: [p('tab-one')] }, { id: 't2', title: 'Hai', blocks: [p('tab-two')] }] }]);
    const rt = createPreviewRuntime(item, 'vi');
    rt.setBlockState('tabs', { active: 't2' });
    render(<LessonRenderer item={item.renders.vi} runtime={rt} />);
    expect(screen.getByRole('tablist', { name: 'Thẻ nội dung' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hai' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('tab-two')).toBeVisible();
    await userEvent.tab();
    expect(screen.getByRole('tab', { name: 'Hai' })).toHaveFocus();
  });
});

describe('links', () => {
  it('resource, opportunity and next_step render hrefs from the runtime', () => {
    const item = lesson([
      { id: 'rl', type: 'resource_link', resourceId: 'cheat', label: 'Cheat sheet' },
      { id: 'ol', type: 'opportunity_link', opportunityId: 'sprint', relationship: 'recommended_next_step' },
      { id: 'ns', type: 'next_step', title: 'Take the exam', target: { kind: 'exam', id: 'exam-1' } },
    ]);
    const rt = createPreviewRuntime(item, 'en');
    render(<LessonRenderer item={item.renders.en} runtime={rt} />);
    expect(screen.getByRole('link', { name: /Cheat sheet/ })).toHaveAttribute('href', '#resource/cheat');
    expect(screen.getByRole('link', { name: /Recommended next step.*View opportunity/ })).toHaveAttribute('href', '#opportunity/sprint');
    expect(screen.queryByText(/sprint|🚀|📄/)).toBeNull();
    expect(screen.getByRole('link', { name: /Take the exam/ })).toHaveAttribute('href', '#exam/exam-1');
    fireEvent.click(screen.getByRole('link', { name: /Cheat sheet/ }));
    expect(rt.getBlockState<{ completed: boolean }>('rl')?.completed).toBe(true);
  });
});
