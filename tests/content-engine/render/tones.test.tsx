import { describe, it, expect, beforeAll, vi } from 'vitest';
vi.mock('shiki/bundle/web', () => ({ createHighlighter: () => new Promise(() => {}) }));
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockList } from '@/content-engine/render/BlockList';
import { registerAllBlocks } from '@/content-engine/render/blocks';
import { registerChoiceQuestions } from '@/content-engine/render/questions';
import { QuestionRenderer } from '@/content-engine/render/QuestionRenderer';
import { RichContentView } from '@/content-engine/render/RichContentView';
import { FrameScope } from '@/content-engine/render/render-context';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import type { LessonBlock, RichContent } from '@/content-engine/schema/types';

const PALETTE = /\b(?:bg|text|border|divide)-(?:neutral|gray|slate|zinc|emerald|green|red|sky|blue|amber|yellow)-\d{2,3}\b|\b(?:bg|text)-(?:white|black)\b/;
const rc = (t: string): RichContent => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const p = (t: string) => ({ type: 'paragraph', content: [{ text: t }] });
const rt = createPreviewRuntime({ id: 'l', kind: 'lesson', checksum: '', renders: { vi: { kind: 'lesson', id: 'l', title: 'L', blocks: [] }, en: { kind: 'lesson', id: 'l', title: 'L', blocks: [] } }, grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [] } }, 'en');
const mount = (blocks: unknown[], depth = 0) => render(<BlockList blocks={blocks as LessonBlock[]} runtime={rt} path="/blocks" depth={depth} />);
beforeAll(() => { registerAllBlocks(); registerChoiceQuestions(); });

describe('semantic tones', () => {
  it('stepper: current step takes the signal fill, visited steps are marked, controls are 44px', async () => {
    const { container } = mount([{ id: 'st', type: 'stepper', linear: true, steps: [{ id: 's1', title: 'Prepare', blocks: [p('one')] }, { id: 's2', title: 'Build', blocks: [p('two')] }, { id: 's3', title: 'Evaluate', blocks: [p('three')] }] }]);
    const steps = () => within(screen.getByRole('region', { name: 'Steps' })).getAllByRole('listitem').map((li) => within(li).getByRole('button'));
    expect(steps()[0]).toHaveAttribute('aria-current', 'step');
    expect(steps()[0]).toHaveClass('bg-primary', 'text-primary-foreground', 'rounded-md', 'min-h-11');
    expect(steps()[2]).toHaveAttribute('data-state', 'locked');
    expect(steps()[2]).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /next step/i }));
    expect(steps()[0]).toHaveAttribute('data-state', 'visited');
    expect(steps()[0]).toHaveClass('bg-muted', 'text-foreground', 'border-border');
    expect(steps()[0]).toHaveAccessibleName(/^Visited: ?1\. Prepare$/);
    expect(steps()[1]).toHaveClass('bg-primary');
    expect(screen.getByRole('region', { name: 'Steps' })).toHaveClass('rounded-lg', 'border-border', 'bg-card');
    expect(container.innerHTML).not.toMatch(PALETTE);
  });

  it('stepper nested in another block renders flat and ends on a signal "Completed" label', async () => {
    mount([{ id: 'st-nested', type: 'stepper', steps: [{ id: 's1', title: 'Only', blocks: [p('one')] }] }], 1);
    expect(screen.getByRole('region', { name: 'Steps' })).toHaveClass('border-t', 'border-border');
    expect(screen.getByRole('region', { name: 'Steps' })).not.toHaveClass('rounded-lg');
    expect(screen.getByText('Completed')).toHaveClass('text-primary');
  });

  it('callouts map every variant onto a semantic tone', () => {
    mount((['info', 'tip', 'warning', 'danger', 'note'] as const).map((variant) => ({ type: 'callout', variant, title: variant, blocks: [p(`${variant} body`)] })));
    expect(screen.getByRole('note', { name: 'info' })).toHaveClass('bg-info', 'border-info-border', 'text-info-foreground', 'border-l-4');
    expect(screen.getByRole('note', { name: 'tip' })).toHaveClass('bg-success', 'border-success-border');
    expect(screen.getByRole('note', { name: 'warning' })).toHaveClass('bg-warning', 'border-warning-border');
    expect(screen.getByRole('note', { name: 'danger' })).toHaveClass('bg-destructive/10', 'border-destructive');
    expect(screen.getByRole('note', { name: 'note' })).toHaveClass('bg-muted', 'border-border');
  });

  it('table rows stripe with muted and every rule has a colour', () => {
    mount([{ type: 'table', headers: [{ content: [{ text: 'H' }] }], rows: [[{ content: [{ text: 'c1' }] }], [{ content: [{ text: 'c2' }] }]] }]);
    expect(screen.getByRole('columnheader')).toHaveClass('border-b-2', 'border-border');
    for (const cell of screen.getAllByRole('cell')) expect(cell).toHaveClass('border-b', 'border-border');
    for (const row of screen.getAllByRole('row').slice(1)) expect(row).toHaveClass('odd:bg-muted');
  });

  it('code blocks carry the data-code-block hook on a muted panel', () => {
    mount([{ type: 'code', language: 'python', code: 'print(1)' }]);
    expect(document.querySelector('[data-code-block]')).toHaveClass('bg-muted', 'border-border');
  });

  it('links never fall back to a raw id and unsupported content never names its schema type', () => {
    mount([{ id: 'rl', type: 'resource_link', resourceId: 'res-raw-id' }, { type: 'math', latex: 'x' }]);
    expect(screen.getByRole('link', { name: /Open resource/ })).toHaveAttribute('href', '#resource/res-raw-id');
    expect(screen.queryByText(/res-raw-id/)).toBeNull();
    const notice = document.querySelector('[data-unavailable="math"]');
    expect(notice).toHaveClass('bg-warning', 'text-warning-foreground', 'border-warning-border');
    expect(notice).not.toHaveTextContent(/math/);
  });

  it('choice options: selected is signal-bordered with a ● mark and a label focus ring; graded tones follow', () => {
    const q = { id: 'q1', type: 'single_choice', content: rc('Which one?'), options: [{ id: 'a', content: rc('Option A') }, { id: 'b', content: rc('Option B') }] };
    const { rerender } = render(<QuestionRenderer question={q} value="b" onChange={() => {}} runtime={rt} />);
    const label = (name: string) => screen.getByRole('radio', { name }).closest('label')!;
    expect(label('Option B')).toHaveAttribute('data-state', 'selected');
    expect(label('Option B')).toHaveClass('border-primary', 'has-[:focus-visible]:outline-2', 'has-[:focus-visible]:outline-ring');
    expect(label('Option B').querySelector('[data-selected-mark]')).toHaveTextContent('●');
    expect(label('Option A')).toHaveClass('border-border');
    expect(label('Option A').querySelector('[data-selected-mark]')).toBeNull();
    rerender(<QuestionRenderer question={q} value="b" onChange={() => {}} disabled runtime={rt} result={{ questionId: 'q1', status: 'incorrect', points: 0, maxPoints: 1 }} revealed={{ correctAnswers: { q1: 'a' }, explanations: { q1: rc('Because A') } }} />);
    expect(label('Option A')).toHaveClass('border-success-border', 'bg-success');
    expect(label('Option B')).toHaveClass('border-destructive', 'bg-destructive/10');
    expect(screen.getByText(/^Incorrect/)).toHaveAttribute('data-tone', 'fault');
    expect(screen.getByText(/^Incorrect/)).toHaveClass('bg-destructive/10', 'text-destructive');
    expect(screen.getByText('Because A').closest('div.border-l-4')).toHaveClass('bg-info', 'border-info-border');
    expect(screen.getByRole('group', { name: /Which one\?/ })).toHaveClass('rounded-lg', 'bg-card');
  });

  it('FrameScope flattens rich content rendered inside an owner card', () => {
    const content = { blocks: [{ id: 'st-scope', type: 'stepper', steps: [{ id: 's1', title: 'Only', blocks: [p('one')] }] }] } as unknown as RichContent;
    const { unmount } = render(<RichContentView content={content} runtime={rt} />);
    expect(screen.getByRole('region', { name: 'Steps' })).toHaveClass('rounded-lg', 'bg-card');
    unmount();
    render(<FrameScope depth={1}><RichContentView content={content} runtime={rt} /></FrameScope>);
    expect(screen.getByRole('region', { name: 'Steps' })).toHaveClass('border-t', 'border-border');
    expect(screen.getByRole('region', { name: 'Steps' })).not.toHaveClass('rounded-lg');
  });

  it('a quiz is one card: its question frames are flat hairline sections', () => {
    mount([{ id: 'qz', type: 'quiz', title: 'Check', questions: [{ id: 'q1', type: 'single_choice', content: rc('First?'), options: [{ id: 'a', content: rc('A') }] }] }]);
    expect(screen.getByRole('region', { name: 'Check' })).toHaveClass('rounded-lg', 'bg-card');
    const frame = screen.getByRole('group', { name: /First\?/ });
    expect(frame).toHaveClass('border-t', 'border-border');
    expect(frame).not.toHaveClass('rounded-lg');
  });
});
