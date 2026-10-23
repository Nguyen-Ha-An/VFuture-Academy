import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerContentBlocks } from '@/content-engine/render/blocks';
import { registerChoiceQuestions } from '@/content-engine/render/questions';
import { QuestionRenderer } from '@/content-engine/render/QuestionRenderer';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import type { RichContent } from '@/content-engine/schema/types';

const rc = (t: string): RichContent => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const rt = createPreviewRuntime({ id: 'x', kind: 'lesson', checksum: '', renders: { vi: { kind: 'lesson', id: 'x', title: 'x', blocks: [] }, en: { kind: 'lesson', id: 'x', title: 'x', blocks: [] } }, grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [] } }, 'en');
beforeAll(() => { registerContentBlocks(); registerChoiceQuestions(); });
const opts = [{ id: 'a', content: rc('Option A') }, { id: 'b', content: rc('Option B') }];

describe('single_choice', () => {
  it('radio emits the option id and shows result + explanation when revealed', async () => {
    const onChange = vi.fn();
    const q = { id: 'q1', type: 'single_choice', content: rc('Which one?'), options: opts, points: 2, hint: rc('Think about A') };
    const { rerender } = render(<QuestionRenderer question={q} value={undefined} onChange={onChange} runtime={rt} />);
    expect(screen.getByRole('group', { name: /Which one\?/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Option B' }));
    expect(onChange).toHaveBeenCalledWith('b');
    await userEvent.click(screen.getByRole('button', { name: /hint/i }));
    expect(screen.getByText('Think about A')).toBeInTheDocument();
    rerender(<QuestionRenderer question={q} value="b" onChange={onChange} disabled runtime={rt} result={{ questionId: 'q1', status: 'incorrect', points: 0, maxPoints: 2 }} revealed={{ correctAnswers: { q1: 'a' }, explanations: { q1: rc('Because A') } }} />);
    expect(screen.getByText(/incorrect/i)).toBeInTheDocument();
    expect(screen.getByText('Because A')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Option A' })).toHaveAttribute('data-correct', 'true');
    expect(screen.getByRole('radio', { name: 'Option B' })).toBeDisabled();
  });
  it('button and dropdown interactions', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<QuestionRenderer question={{ id: 'q', type: 'single_choice', content: rc('?'), options: opts, display: { interactionType: 'button' } }} value={undefined} onChange={onChange} runtime={rt} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Option A' }));
    expect(onChange).toHaveBeenLastCalledWith('a');
    rerender(<QuestionRenderer question={{ id: 'q', type: 'single_choice', content: rc('?'), options: opts, display: { interactionType: 'dropdown' } }} value={undefined} onChange={onChange} runtime={rt} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'b');
    expect(onChange).toHaveBeenLastCalledWith('b');
  });
  it('unknown interaction renders an unavailable notice', () => {
    render(<QuestionRenderer question={{ id: 'q', type: 'single_choice', content: rc('?'), options: opts, display: { interactionType: 'circle' } }} value={undefined} onChange={() => {}} runtime={rt} />);
    expect(document.querySelector('[data-unavailable="single_choice:circle"]')).toBeInTheDocument();
  });
});

describe('multiple_choice', () => {
  it('checkbox toggles ids and respects maxSelections', async () => {
    const onChange = vi.fn();
    const q = { id: 'm', type: 'multiple_choice', content: rc('Pick two'), options: [...opts, { id: 'c', content: rc('Option C') }], maxSelections: 2 };
    const { rerender } = render(<QuestionRenderer question={q} value={['a']} onChange={onChange} runtime={rt} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Option B' }));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    rerender(<QuestionRenderer question={q} value={['a', 'b']} onChange={onChange} runtime={rt} />);
    expect(screen.getByRole('checkbox', { name: 'Option C' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Option A' }));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
  });
});

describe('true_false', () => {
  it('boolean and yes_no labels', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<QuestionRenderer question={{ id: 't', type: 'true_false', content: rc('AI is ML') }} value={undefined} onChange={onChange} runtime={rt} />);
    await userEvent.click(screen.getByRole('radio', { name: 'False' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    rerender(<QuestionRenderer question={{ id: 't', type: 'true_false', content: rc('?'), display: { interactionType: 'yes_no' } }} value={true} onChange={onChange} runtime={rt} />);
    expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
  });
});
