// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { QuizRenderer } from '@/content-engine/render/QuizRenderer';
import { registerAll } from '@/content-engine/render';
import type { LessonRuntime } from '@/content-engine/render/runtime';

it('passes quiz and pinned root/leaf identity without creating an attempt', async () => {
  registerAll();
  const uploadFile = vi.fn(async (file: File) => ({ assetId: 'asset-test', name: file.name, size: file.size, mime: file.type }));
  const runtime = { mode: 'learner', locale: 'en', uploadFile, getBlockState: () => undefined, setBlockState: vi.fn(), resolveMedia: () => '', onActivityComplete: vi.fn() } as unknown as LessonRuntime;
  const block = { id: 'quiz-q', type: 'quiz', title: 'Practice', questions: [{ id: 'upload-q', type: 'upload_answer', selfAssessment: true, accepts: ['file'], content: { blocks: [{ type: 'paragraph', content: [{ text: 'Upload your work' }] }] } }] };
  render(<QuizRenderer block={block as never} runtime={runtime} />);
  const file = new File(['example'], 'work.pdf', { type: 'application/pdf' });
  await userEvent.upload(screen.getByLabelText('Upload files'), file);
  await waitFor(() => expect(uploadFile).toHaveBeenCalledWith(file, expect.objectContaining({ quizId: 'quiz-q', rootQuestionId: 'upload-q', questionId: 'upload-q' })));
});

it('blocks submission while a quiz file is uploading and keeps the answer available after failure', async () => {
  registerAll();
  let rejectUpload!: (cause: Error) => void;
  const uploadFile = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectUpload = reject; }));
  const submitQuiz = vi.fn();
  const runtime = { mode: 'learner', locale: 'en', uploadFile, submitQuiz, getBlockState: () => undefined, setBlockState: vi.fn(), resolveMedia: () => '', onActivityComplete: vi.fn() } as unknown as LessonRuntime;
  const block = { id: 'quiz-q', type: 'quiz', title: 'Practice', settings: { mode: 'graded', feedback: 'after_submit' }, questions: [{ id: 'upload-q', type: 'upload_answer', selfAssessment: true, accepts: ['file'], content: { blocks: [{ type: 'paragraph', content: [{ text: 'Upload your work' }] }] } }] };
  render(<QuizRenderer block={block as never} runtime={runtime} />);
  await userEvent.upload(screen.getByLabelText('Upload files'), new File(['example'], 'work.pdf', { type: 'application/pdf' }));
  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Wait for uploads to finish');
  expect(submitQuiz).not.toHaveBeenCalled();
  rejectUpload(new Error('offline'));
  expect(await screen.findByText('Upload failed for work.pdf')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry work.pdf' })).toBeInTheDocument();
});
