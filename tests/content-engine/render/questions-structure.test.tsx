import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerContentBlocks } from '@/content-engine/render/blocks';
import { registerStructureQuestions } from '@/content-engine/render/questions';
import { QuestionRenderer } from '@/content-engine/render/QuestionRenderer';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import type { RichContent } from '@/content-engine/schema/types';

const rc = (t: string): RichContent => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const item = (id: string, text: string) => ({ id, content: rc(text) });
const rt = createPreviewRuntime({ id: 'x', kind: 'lesson', checksum: '', renders: { vi: { kind: 'lesson', id: 'x', title: 'x', blocks: [] }, en: { kind: 'lesson', id: 'x', title: 'x', blocks: [] } }, grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [] } }, 'en');
beforeAll(() => { registerContentBlocks(); registerStructureQuestions(); });

describe('matching', () => {
  const q = { id: 'm', type: 'matching', content: rc('Match'), left: [item('l1', 'Vietnam'), item('l2', 'France')], right: [item('r1', 'Hanoi'), item('r2', 'Paris'), item('r3', 'Rome')] };
  it('selects emit edges; revealed marks parts', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<QuestionRenderer question={q} value={[]} onChange={onChange} runtime={rt} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Vietnam/ }), 'r1');
    expect(onChange).toHaveBeenLastCalledWith([{ left: 'l1', right: 'r1' }]);
    rerender(<QuestionRenderer question={q} value={[{ left: 'l1', right: 'r1' }]} onChange={onChange} runtime={rt} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /France/ }), 'r3');
    expect(onChange).toHaveBeenLastCalledWith([{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r3' }]);
    rerender(<QuestionRenderer question={q} value={[{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r3' }]} onChange={onChange} disabled runtime={rt} result={{ questionId: 'm', status: 'partial', points: 1, maxPoints: 2, parts: { l1: 'correct', l2: 'incorrect' } }} revealed={{ correctAnswers: { m: [{ left: 'l1', right: 'r1' }, { left: 'l2', right: 'r2' }] } }} />);
    expect(screen.getByText(/Paris/, { selector: '[data-answer-key]' })).toHaveClass('text-primary');
  });
  it('lines variant renders an svg overlay', () => {
    render(<QuestionRenderer question={{ ...q, display: { interactionType: 'lines' } }} value={[{ left: 'l1', right: 'r1' }]} onChange={() => {}} runtime={rt} />);
    expect(document.querySelector('svg[data-connectors]')).toBeInTheDocument();
  });
});

describe('ordering', () => {
  const q = { id: 'o', type: 'ordering', content: rc('Order'), items: [item('a', 'Mix'), item('b', 'Bake'), item('c', 'Prepare')] };
  it('move buttons reorder and emit the full order', async () => {
    const onChange = vi.fn();
    render(<QuestionRenderer question={q} value={undefined} onChange={onChange} runtime={rt} />);
    const list = screen.getByRole('list', { name: /Order/ });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Mix')]));
    await userEvent.click(within(list).getAllByRole('button', { name: /move up/i })[2]);
    expect(onChange).toHaveBeenLastCalledWith(['a', 'c', 'b']);
  });
  it('timeline shows slot labels', () => {
    render(<QuestionRenderer question={{ ...q, display: { interactionType: 'timeline' }, slots: [{ id: 's1', label: '1945' }, { id: 's2', label: '1975' }, { id: 's3', label: '1986' }] }} value={['a', 'b', 'c']} onChange={() => {}} runtime={rt} />);
    expect(screen.getByText('1975')).toBeInTheDocument();
  });
});

describe('classification', () => {
  const q = { id: 'c', type: 'classification', content: rc('Sort'), categories: [{ id: 'ml', label: 'Machine learning' }, { id: 'rules', label: 'Rules' }], items: [item('i1', 'Spam filter'), item('i2', 'Tax table')] };
  it('select per item assigns categories and buckets show placed items', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<QuestionRenderer question={q} value={{}} onChange={onChange} runtime={rt} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /Spam filter/ }), 'ml');
    expect(onChange).toHaveBeenLastCalledWith({ i1: 'ml' });
    rerender(<QuestionRenderer question={q} value={{ i1: 'ml' }} onChange={onChange} runtime={rt} />);
    expect(within(screen.getByRole('region', { name: 'Machine learning' })).getByText('Spam filter')).toBeInTheDocument();
  });
});
