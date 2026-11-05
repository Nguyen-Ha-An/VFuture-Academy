import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { registerAll } from '@/content-engine/render';
import { LessonRenderer } from '@/content-engine/render/LessonRenderer';
import type { QuizState } from '@/content-engine/render/QuizRenderer';
import { createPreviewRuntime } from '@/content-engine/render/preview-runtime';
import { compileCourse } from '@/content-engine/compile';
import { InMemoryResolver } from '@/content-engine/validate';

beforeAll(() => registerAll());
const rich = (text: string) => ({ blocks: [{ type: 'paragraph', content: [{ text }] }] });
const choice = (id: string, text: string) => ({ id, type: 'single_choice', content: rich(text), options: [{ id: 'a', content: rich('A') }, { id: 'b', content: rich('B') }], correctAnswer: 'a', explanation: rich(`Explanation for ${id}`) });

async function groupedQuiz(layout: 'list' | 'tabs' = 'list', mode: 'practice' | 'graded' = 'practice', withUpload = false, required = true, locale: 'en' | 'vi' = 'en', attemptsAllowed?: number) {
  const manifest = {
    schemaVersion: 1, kind: 'course', id: 'course', title: 'Course', summary: 'Summary', languages: ['en'], defaultLanguage: 'en',
    level: 'foundation', difficulty: 'beginner', pathway: 'core-future-skills', learningOutcomes: ['Read evidence'], access: { scope: 'global' },
    modules: [{ id: 'module', title: 'Module', items: [{ type: 'lesson', id: 'lesson' }] }],
  };
  const lesson = { schemaVersion: 1, kind: 'lesson', id: 'lesson', title: 'Lesson', blocks: [{
    id: 'practice', type: 'quiz', title: 'Grouped practice', settings: { mode, feedback: 'per_question', required, ...(attemptsAllowed === undefined ? {} : { attemptsAllowed }) },
    questions: [{ id: 'shared', type: 'question_group', sharedContent: rich('Shared evidence'), display: { layout }, questions: [
      withUpload ? { id: 'left', type: 'upload_answer', content: rich('Upload evidence'), points: 0, selfAssessment: true, accepts: ['file'], allowedMimeTypes: ['text/plain'], maxFiles: 1 } : choice('left', 'Left question'),
      choice('right', 'Right question'),
    ] }, ...(withUpload ? [choice('outside', 'Outside question')] : [])],
  }] };
  const result = await compileCourse({ manifest, items: { lesson } }, new InMemoryResolver({}));
  if (!result.compiled) throw new Error(JSON.stringify(result.diagnostics));
  const item = result.compiled.items.lesson;
  const rootId = item.grading.quizzes.practice.questionIds[0];
  const children = item.grading.questions[rootId].children;
  if (!children || children.length !== 2) throw new Error('The compiled fixture must contain two group children.');
  const runtime = createPreviewRuntime(item, locale, 'en');
  const check = vi.spyOn(runtime, 'checkQuestion');
  const submit = vi.spyOn(runtime, 'submitQuiz');
  const complete = vi.spyOn(runtime, 'onActivityComplete');
  render(<LessonRenderer item={item.renders.en} runtime={runtime} />);
  return { runtime, check, submit, complete, rootId, left: children[0].id, right: children[1].id, outside: item.grading.quizzes.practice.questionIds[1] };
}

describe('grouped practice question checks', () => {
  it('checks compiled leaf IDs with their nested values and retries only the selected child', async () => {
    const fixture = await groupedQuiz();
    const user = userEvent.setup();
    expect(screen.getByText('Shared evidence')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Check answer' })).toHaveLength(2);
    await user.click(screen.getAllByRole('radio', { name: 'A' })[0]);
    await user.click(screen.getAllByRole('radio', { name: 'B' })[1]);
    await user.click(screen.getAllByRole('button', { name: 'Check answer' })[0]);
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(fixture.check.mock.calls).toEqual([
      ['practice', fixture.left, 'a'], ['practice', fixture.right, 'b'],
    ]);
    const checked = fixture.runtime.getBlockState<QuizState>('practice');
    expect(checked?.answers[fixture.rootId]).toEqual({ [fixture.left]: 'a', [fixture.right]: 'b' });
    expect(Object.keys(checked?.checks ?? {})).toEqual([fixture.left, fixture.right]);
    await user.click(screen.getAllByRole('button', { name: 'Try again' })[0]);
    const retried = fixture.runtime.getBlockState<QuizState>('practice');
    expect(retried?.answers[fixture.rootId]).toEqual({ [fixture.left]: undefined, [fixture.right]: 'b' });
    expect(retried?.checks[fixture.left]).toBeUndefined();
    expect(retried?.checks[fixture.right]).toEqual(checked?.checks[fixture.right]);
    expect(retried?.submissions).toBe(0);
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it('keeps sibling feedback when a child check fails and retries the same leaf answer', async () => {
    const fixture = await groupedQuiz();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('radio', { name: 'A' })[1]);
    await user.click(screen.getAllByRole('button', { name: 'Check answer' })[1]);
    const sibling = fixture.runtime.getBlockState<QuizState>('practice')?.checks[fixture.right];
    fixture.check.mockRejectedValueOnce(new Error('Temporary check failure'));
    const leftAnswer = screen.getAllByRole('radio', { name: 'A' })[0];
    await user.click(leftAnswer);
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not check this answer');
    expect(leftAnswer).toBeChecked();
    expect(fixture.runtime.getBlockState<QuizState>('practice')?.checks[fixture.right]).toEqual(sibling);
    await user.click(screen.getByRole('button', { name: 'Try checking again' }));
    expect(fixture.check.mock.calls.slice(-2)).toEqual([['practice', fixture.left, 'a'], ['practice', fixture.left, 'a']]);
    expect(fixture.runtime.getBlockState<QuizState>('practice')?.checks[fixture.right]).toEqual(sibling);
  });

  it('keeps tab order and shared content while exposing only the active leaf check', async () => {
    const fixture = await groupedQuiz('tabs');
    const user = userEvent.setup();
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['1.1', '1.2']);
    expect(screen.getByText('Shared evidence')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Check answer' })).toHaveLength(1);
    await user.click(screen.getByRole('radio', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    await user.click(screen.getByRole('tab', { name: '1.2' }));
    await user.click(screen.getByRole('radio', { name: 'B' }));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(fixture.check.mock.calls).toEqual([['practice', fixture.left, 'a'], ['practice', fixture.right, 'b']]);
  });

  it('never exposes practice checks in graded mode, including an explicit per-question feedback setting', async () => {
    const fixture = await groupedQuiz('list', 'graded');
    expect(screen.queryByRole('button', { name: 'Check answer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish practice' })).not.toBeInTheDocument();
    expect(fixture.check).not.toHaveBeenCalled();
  });

  it('preserves edits inside and outside a group when a real upload leaf resolves later', async () => {
    const fixture = await groupedQuiz('list', 'practice', true);
    let resolveUpload!: (file: Awaited<ReturnType<typeof fixture.runtime.uploadFile>>) => void;
    vi.spyOn(fixture.runtime, 'uploadFile').mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));
    const user = userEvent.setup();
    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('The actual upload question must render its file input.');
    await user.upload(input, new File(['evidence'], 'evidence.txt', { type: 'text/plain' }));
    expect(screen.getByRole('button', { name: 'Finish practice' })).toBeDisabled();
    await user.click(screen.getAllByRole('radio', { name: 'A' })[0]);
    await user.click(screen.getAllByRole('radio', { name: 'B' })[1]);
    const uploaded = { assetId: 'uploaded-asset', name: 'evidence.txt', size: 8, mime: 'text/plain' };
    await act(async () => { resolveUpload(uploaded); });
    const state = fixture.runtime.getBlockState<QuizState>('practice');
    expect(state?.answers[fixture.rootId]).toEqual({ [fixture.left]: { files: [uploaded] }, [fixture.right]: 'a' });
    expect(state?.answers[fixture.outside]).toBe('b');
    expect(state?.submissions).toBe(0);
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.complete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Finish practice' })).toBeEnabled();
  });

  it('records an aggregate attempt and completion only after explicitly finishing practice', async () => {
    const fixture = await groupedQuiz();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('radio', { name: 'A' })[0]);
    await user.click(screen.getAllByRole('radio', { name: 'B' })[1]);
    await user.click(screen.getAllByRole('button', { name: 'Check answer' })[0]);
    expect(fixture.submit).not.toHaveBeenCalled();
    expect(fixture.complete).not.toHaveBeenCalled();
    expect(fixture.runtime.getBlockState<QuizState>('practice')?.submissions).toBe(0);
    expect(screen.queryByText(/^Score:/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finish practice' }));
    expect(fixture.submit).toHaveBeenCalledExactlyOnceWith('practice', { [fixture.rootId]: { [fixture.left]: 'a', [fixture.right]: 'b' } });
    expect(fixture.complete).toHaveBeenCalledExactlyOnceWith('practice');
    const state = fixture.runtime.getBlockState<QuizState>('practice');
    expect(state?.submissions).toBe(1);
    const formalResult = await fixture.submit.mock.results[0].value;
    expect(state?.last).toEqual(formalResult);
    expect(screen.getByText(/^Score:/)).toHaveTextContent(`${formalResult.points}/${formalResult.maxPoints} (${formalResult.percent}%)`);
    expect(screen.queryByRole('button', { name: 'Check answer' })).not.toBeInTheDocument();
  });

  it('allows optional practice to record a formal result and localizes the explicit finish action', async () => {
    await groupedQuiz('list', 'practice', false, false, 'vi');
    expect(screen.getByRole('button', { name: 'Hoàn tất luyện tập' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Nộp bài' })).not.toBeInTheDocument();
  });

  it('deduplicates an explicit finish before the busy state commits', async () => {
    const fixture = await groupedQuiz();
    fixture.submit.mockImplementation(() => new Promise(() => {}));
    const finish = screen.getByRole('button', { name: 'Finish practice' });
    act(() => { finish.click(); finish.click(); });
    expect(fixture.submit).toHaveBeenCalledOnce();
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it('keeps answers and checks after a failed finish, then retries the same formal submission', async () => {
    const fixture = await groupedQuiz();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('radio', { name: 'A' })[0]);
    await user.click(screen.getAllByRole('button', { name: 'Check answer' })[0]);
    const before = fixture.runtime.getBlockState<QuizState>('practice');
    fixture.submit.mockRejectedValueOnce(new Error('Temporary submit failure'));
    await user.click(screen.getByRole('button', { name: 'Finish practice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your answers are still here');
    expect(fixture.runtime.getBlockState<QuizState>('practice')).toEqual(before);
    expect(fixture.complete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Finish practice' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Finish practice' }));
    expect(fixture.submit.mock.calls).toEqual([['practice', before?.answers], ['practice', before?.answers]]);
    expect(fixture.complete).toHaveBeenCalledExactlyOnceWith('practice');
  });

  it('honors the existing attempt limit after a formal practice finish', async () => {
    await groupedQuiz('list', 'practice', false, true, 'en', 1);
    await userEvent.click(screen.getByRole('button', { name: 'Finish practice' }));
    expect(screen.getByText(/^Score:/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish practice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByText('0 attempts left')).toBeInTheDocument();
  });
});
