import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { registerContentBlocks } from '@/content-engine/render/blocks';
import { registerChoiceQuestions, registerStructureQuestions, registerTextQuestions } from '@/content-engine/render/questions';
import { QuestionRenderer } from '@/content-engine/render/QuestionRenderer';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import type { RichContent } from '@/content-engine/schema/types';

// WCAG 1.4.1: a revealed correct answer carries a visible ✓ and a screen-reader label, never colour alone.
const rc = (t: string): RichContent => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const lesson = { kind: 'lesson' as const, id: 'x', title: 'x', blocks: [] };
const grading = { questions: {}, quizzes: {}, rubrics: {}, activities: [] };
const runtime = (locale: 'en' | 'vi') => createPreviewRuntime({ id: 'x', kind: 'lesson', checksum: '', renders: { vi: lesson, en: lesson }, grading }, locale);
const opts = [{ id: 'a', content: rc('Option A') }, { id: 'b', content: rc('Option B') }];
beforeAll(() => { registerContentBlocks(); registerChoiceQuestions(); registerStructureQuestions(); registerTextQuestions(); });

const marks = (root: HTMLElement | Document = document) => [...root.querySelectorAll('[data-correct-mark]')];

describe('revealed correct answers', () => {
  it('marks a correct option the learner did not choose with ✓ and "Correct answer"', () => {
    const q = { id: 'q1', type: 'single_choice', content: rc('Which one?'), options: opts };
    render(<QuestionRenderer question={q} value="b" onChange={() => {}} disabled runtime={runtime('en')} result={{ questionId: 'q1', status: 'incorrect', points: 0, maxPoints: 1 }} revealed={{ correctAnswers: { q1: 'a' } }} />);
    const correct = screen.getByRole('radio', { name: 'Option A' });
    const label = correct.closest('label')!;
    expect(marks(label)).toHaveLength(1);
    expect(label).toHaveTextContent('✓');
    expect(correct).toHaveAccessibleDescription('Correct answer');
    const chosen = screen.getByRole('radio', { name: 'Option B' }).closest('label')!;
    expect(marks(chosen)).toHaveLength(0);
    expect(chosen.querySelector('[data-selected-mark]')).toBeInTheDocument();
  });

  it('localizes the label and marks every correct option of a multiple choice', () => {
    const q = { id: 'q2', type: 'multiple_choice', content: rc('Pick'), options: [...opts, { id: 'c', content: rc('Option C') }] };
    render(<QuestionRenderer question={q} value={['a']} onChange={() => {}} disabled runtime={runtime('vi')} revealed={{ correctAnswers: { q2: ['a', 'c'] } }} />);
    expect(screen.getByRole('checkbox', { name: 'Option C' })).toHaveAccessibleDescription('Đáp án đúng');
    expect(marks()).toHaveLength(2);
  });

  it('marks the correct true/false side', () => {
    const q = { id: 'q3', type: 'true_false', content: rc('Sky is blue') };
    render(<QuestionRenderer question={q} value={false} onChange={() => {}} disabled runtime={runtime('en')} revealed={{ correctAnswers: { q3: true } }} />);
    expect(screen.getByRole('radio', { name: 'True' })).toHaveAccessibleDescription('Correct answer');
    expect(marks()).toHaveLength(1);
  });

  it('marks correct matching, ordering and classification parts and the answer keys', () => {
    const item = (id: string, text: string) => ({ id, content: rc(text) });
    const matching = { id: 'm', type: 'matching', content: rc('Match'), left: [item('l1', 'Vietnam'), item('l2', 'France')], right: [item('r1', 'Hanoi'), item('r2', 'Paris')] };
    const { unmount } = render(<QuestionRenderer question={matching} value={[{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r1' }]} onChange={() => {}} disabled runtime={runtime('en')} result={{ questionId: 'm', status: 'partial', points: 1, maxPoints: 2, parts: { l1: 'correct', l2: 'incorrect' } }} revealed={{ correctAnswers: { m: [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r2' }] } }} />);
    const vietnam = document.querySelector<HTMLElement>('[data-left="l1"]')!;
    const france = document.querySelector<HTMLElement>('[data-left="l2"]')!;
    // The correct part carries a mark in its row plus one in its answer key; the wrong part only its key.
    expect(marks(vietnam)).toHaveLength(2);
    expect(marks(france)).toHaveLength(1);
    expect(within(france).getByText(/Paris/, { selector: '[data-answer-key]' })).toHaveTextContent('Correct answer');
    unmount();

    const ordering = { id: 'o', type: 'ordering', content: rc('Order'), items: [item('a', 'Mix'), item('b', 'Bake')] };
    const second = render(<QuestionRenderer question={ordering} value={['a', 'b']} onChange={() => {}} disabled runtime={runtime('en')} result={{ questionId: 'o', status: 'partial', points: 1, maxPoints: 2, parts: { a: 'correct', b: 'incorrect' } }} />);
    const rows = screen.getAllByRole('listitem');
    expect(marks(rows[0])).toHaveLength(1);
    expect(marks(rows[1])).toHaveLength(0);
    second.unmount();

    const classification = { id: 'c', type: 'classification', content: rc('Sort'), categories: [{ id: 'fruit', label: 'Fruit' }], items: [item('apple', 'Apple'), item('rock', 'Rock')] };
    render(<QuestionRenderer question={classification} value={{ apple: 'fruit', rock: 'fruit' }} onChange={() => {}} disabled runtime={runtime('en')} result={{ questionId: 'c', status: 'partial', points: 1, maxPoints: 2, parts: { apple: 'correct', rock: 'incorrect' } }} />);
    expect(marks()).toHaveLength(1);
    expect(screen.getByText('Correct answer')).toHaveClass('sr-only');
  });
});
