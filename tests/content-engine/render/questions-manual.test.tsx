import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@uiw/react-codemirror', () => ({ default: ({ value, onChange, 'aria-label': label }: { value: string; onChange: (v: string) => void; 'aria-label'?: string }) => <textarea aria-label={label ?? 'code'} value={value} onChange={(e) => onChange(e.target.value)} /> }));

import { registerContentBlocks } from '@/content-engine/render/blocks';
import { registerAllQuestions } from '@/content-engine/render/questions';
import { QuestionRenderer } from '@/content-engine/render/QuestionRenderer';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import type { RichContent } from '@/content-engine/schema/types';

const rc = (t: string): RichContent => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const rt = createPreviewRuntime({ id: 'x', kind: 'lesson', checksum: '', renders: { vi: { kind: 'lesson', id: 'x', title: 'x', blocks: [] }, en: { kind: 'lesson', id: 'x', title: 'x', blocks: [] } }, grading: { questions: {}, quizzes: {}, rubrics: {}, activities: [] } }, 'en');
beforeAll(() => { registerContentBlocks(); registerAllQuestions(); });

describe('upload_answer', () => {
  it('uploads files through the runtime, adds links and text', async () => {
    const onChange = vi.fn();
    const q = { id: 'u', type: 'upload_answer', content: rc('Submit'), accepts: ['file', 'link', 'text'], maxFiles: 2, allowedMimeTypes: ['application/pdf'], linkHosts: ['github.com'] };
    const { rerender } = render(<QuestionRenderer question={q} value={{}} onChange={onChange} runtime={rt} />);
    const file = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/upload files/i), file);
    expect(onChange).toHaveBeenLastCalledWith({ files: [{ assetId: expect.stringMatching(/^preview_/), name: 'report.pdf', size: 4, mime: 'application/pdf' }] });
    rerender(<QuestionRenderer question={q} value={{ files: [{ assetId: 'a', name: 'report.pdf', size: 4, mime: 'application/pdf' }] }} onChange={onChange} runtime={rt} />);
    await userEvent.type(screen.getByRole('textbox', { name: /link url/i }), 'https://github.com/x/y');
    await userEvent.click(screen.getByRole('button', { name: /add link/i }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ links: [{ url: 'https://github.com/x/y' }] }));
    await userEvent.type(screen.getByRole('textbox', { name: /notes/i }), 'done');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'done' }));
  });
  it('rejects links outside linkHosts and wrong mime types with a message', async () => {
    render(<QuestionRenderer question={{ id: 'u', type: 'upload_answer', content: rc('Submit'), accepts: ['link', 'file'], linkHosts: ['github.com'], allowedMimeTypes: ['application/pdf'] }} value={{}} onChange={() => {}} runtime={rt} />);
    await userEvent.type(screen.getByRole('textbox', { name: /link url/i }), 'https://evil.com/x');
    await userEvent.click(screen.getByRole('button', { name: /add link/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/github.com/);
  });
});

describe('code_answer', () => {
  it('renders the editor with starter code and emits { code, language }', async () => {
    const onChange = vi.fn();
    render(<QuestionRenderer question={{ id: 'k', type: 'code_answer', content: rc('Loop'), language: 'python', starterCode: 'for i in range(3):\n    pass' }} value={undefined} onChange={onChange} runtime={rt} />);
    const editor = screen.getByLabelText(/code editor/i);
    expect(editor).toHaveValue('for i in range(3):\n    pass');
    await userEvent.type(editor, ' ');
    expect(onChange).toHaveBeenLastCalledWith({ code: 'for i in range(3):\n    pass ', language: 'python' });
  });
});

describe('question_group', () => {
  const sc = (id: string, text: string) => ({ id, type: 'single_choice', content: rc(text), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }] });
  const g = { id: 'g', type: 'question_group', sharedContent: rc('Read this passage'), questions: [sc('g/c1', 'First?'), sc('g/c2', 'Second?')] };
  it('renders shared content, children numbered, and nests answers by composite id', async () => {
    const onChange = vi.fn();
    render(<QuestionRenderer question={g} value={{ 'g/c1': 'a' }} onChange={onChange} runtime={rt} index={2} />);
    expect(screen.getByText('Read this passage')).toBeInTheDocument();
    expect(screen.getByText('3.1')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('radio', { name: 'B' })[1]);
    expect(onChange).toHaveBeenLastCalledWith({ 'g/c1': 'a', 'g/c2': 'b' });
  });
  it('passes child results and tabs layout', () => {
    render(<QuestionRenderer question={{ ...g, display: { interactionType: 'list', layout: 'tabs' } }} value={{}} onChange={() => {}} runtime={rt} result={{ questionId: 'g', status: 'partial', points: 1, maxPoints: 2, children: [{ questionId: 'g/c1', status: 'correct', points: 1, maxPoints: 1 }, { questionId: 'g/c2', status: 'incorrect', points: 0, maxPoints: 1 }] }} />);
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText(/correct/i)).toBeInTheDocument();
    const selectedTab = screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selectedTab?.getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id);
  });
  it('tabs layout follows the ARIA tabs keyboard contract', async () => {
    const tabbed = { ...g, questions: [...g.questions, sc('g/c3', 'Third?')], display: { interactionType: 'list', layout: 'tabs' } };
    render(<QuestionRenderer question={tabbed} value={{}} onChange={() => {}} runtime={rt} index={0} />);
    expect(screen.getByRole('tablist', { name: 'Questions in this group' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['1.1', '1.2', '1.3']);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    await userEvent.tab();
    expect(tabs[0]).toHaveFocus();
    expect(tabs.filter((t) => t.tabIndex === 0)).toEqual([tabs[0]]);
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('Second?').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('First?')).toHaveLength(0);
    await userEvent.keyboard('{End}');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Home}');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    expect(tabs[2]).toHaveFocus();
    expect(screen.getAllByRole('tab').filter((t) => t.tabIndex === 0)).toEqual([tabs[2]]);
    expect(tabs[2].getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id);
  });
});
