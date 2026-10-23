import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerContentBlocks } from '@/content-engine/render/blocks';
import { registerTextQuestions } from '@/content-engine/render/questions';
import { QuestionRenderer } from '@/content-engine/render/QuestionRenderer';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import type { RichContent } from '@/content-engine/schema/types';

const rc = (t: string): RichContent => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const rt = createPreviewRuntime({ id: 'x', kind: 'lesson', checksum: '', renders: { vi: { kind: 'lesson', id: 'x', title: 'x', blocks: [] }, en: { kind: 'lesson', id: 'x', title: 'x', blocks: [] } }, grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [] } }, 'en');
beforeAll(() => { registerContentBlocks(); registerTextQuestions(); });
const stem: RichContent = { blocks: [{ type: 'paragraph', content: [{ text: 'The capital is ' }, { blank: 'b1' }, { text: ' and the river is ' }, { blank: 'b2', size: 'lg' }] }] };

describe('fill_blank', () => {
  it('typed blanks render inline inputs and emit a record', async () => {
    const onChange = vi.fn();
    render(<QuestionRenderer question={{ id: 'f', type: 'fill_blank', content: stem, blanks: [{ id: 'b1' }, { id: 'b2' }] }} value={{}} onChange={onChange} runtime={rt} />);
    await userEvent.type(screen.getByRole('textbox', { name: /blank 1/i }), 'Hanoi');
    expect(onChange).toHaveBeenLastCalledWith({ b1: 'Hanoi' });
  });
  it('dropdown blanks render selects', async () => {
    const onChange = vi.fn();
    render(<QuestionRenderer question={{ id: 'f', type: 'fill_blank', content: stem, display: { interactionType: 'dropdown' }, blanks: [{ id: 'b1', options: ['Hanoi', 'Hue'] }, { id: 'b2', options: ['Red River', 'Mekong'] }] }} value={{}} onChange={onChange} runtime={rt} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /blank 2/i }), 'Mekong');
    expect(onChange).toHaveBeenLastCalledWith({ b2: 'Mekong' });
  });
  it('word bank: click a word then a blank; used words disappear; revealed shows correct text', async () => {
    const onChange = vi.fn();
    const q = { id: 'f', type: 'fill_blank', content: stem, display: { interactionType: 'word_bank' }, blanks: [{ id: 'b1' }, { id: 'b2' }], wordBank: [{ id: 'w1', text: 'Hanoi' }, { id: 'w2', text: 'Red River' }, { id: 'w3', text: 'Hue' }] };
    const { rerender } = render(<QuestionRenderer question={q} value={{}} onChange={onChange} runtime={rt} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hanoi' }));
    await userEvent.click(screen.getByRole('button', { name: /blank 1/i }));
    expect(onChange).toHaveBeenLastCalledWith({ b1: 'w1' });
    rerender(<QuestionRenderer question={q} value={{ b1: 'w1' }} onChange={onChange} runtime={rt} />);
    expect(screen.queryByRole('button', { name: 'Hanoi' })).toBeNull();
    expect(screen.getByRole('button', { name: /blank 1.*Hanoi/i })).toBeInTheDocument();
    rerender(<QuestionRenderer question={q} value={{ b1: 'w3' }} onChange={onChange} disabled runtime={rt} result={{ questionId: 'f', status: 'incorrect', points: 0, maxPoints: 1, parts: { b1: 'incorrect', b2: 'missing' } }} revealed={{ correctAnswers: { f: { b1: 'w1', b2: 'w2' } } }} />);
    const key = screen.getByText(/Hanoi/, { selector: '[data-answer-key]' });
    expect(key).toHaveTextContent('✓Correct answer Hanoi');
    expect(key.querySelector('[data-correct-mark] .sr-only')).toHaveTextContent('Correct answer');
  });
});

describe('short_answer / numeric / essay', () => {
  it('short_answer input and revealed accepted answers', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<QuestionRenderer question={{ id: 's', type: 'short_answer', content: rc('Name it'), maxLength: 20 }} value="" onChange={onChange} runtime={rt} />);
    await userEvent.type(screen.getByRole('textbox'), 'LLM');
    expect(onChange).toHaveBeenLastCalledWith('LLM');
    rerender(<QuestionRenderer question={{ id: 's', type: 'short_answer', content: rc('Name it') }} value="LLM" onChange={onChange} disabled runtime={rt} result={{ questionId: 's', status: 'correct', points: 1, maxPoints: 1 }} revealed={{ correctAnswers: { s: ['LLM', 'large language model'] } }} />);
    expect(screen.getByText(/large language model/)).toBeInTheDocument();
  });
  it('numeric uses decimal input mode and shows the unit', async () => {
    const onChange = vi.fn();
    render(<QuestionRenderer question={{ id: 'n', type: 'numeric', content: rc('3+1.14'), unit: 'cm' }} value="" onChange={onChange} runtime={rt} />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    await userEvent.type(input, '4,14');
    expect(onChange).toHaveBeenLastCalledWith('4,14');
    expect(screen.getByText('cm')).toBeInTheDocument();
  });
  it('essay: single prompt with word count, multi prompt with array value, rubric visible', async () => {
    const onChange = vi.fn();
    const rubric = { criteria: [{ id: 'c', name: 'Clarity', maxPoints: 4 }] };
    const { rerender } = render(<QuestionRenderer question={{ id: 'e', type: 'essay', content: rc('Discuss'), minWords: 3, maxWords: 50, rubric }} value="" onChange={onChange} runtime={rt} />);
    await userEvent.type(screen.getByRole('textbox'), 'one two');
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument();
    expect(screen.getByText('Clarity')).toBeInTheDocument();
    rerender(<QuestionRenderer question={{ id: 'e', type: 'essay', content: rc('Look'), prompts: ['a. What?', 'b. Why?'] }} value={['x', '']} onChange={onChange} runtime={rt} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'b. Why?' }), 'y');
    expect(onChange).toHaveBeenLastCalledWith(['x', 'y']);
  });
});
