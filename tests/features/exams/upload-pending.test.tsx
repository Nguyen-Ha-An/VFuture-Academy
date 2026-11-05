// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import { createPreviewRuntime } from '@/content-engine/render';
import { ExamPlayer } from '@/features/exams/ui/ExamPlayer';
import { InMemoryExamRepo } from '@/features/exams/memory-repo';
import { createExamService } from '@/features/exams/service';
import { examSections, type LearnerExam } from '@/features/exams/ui/types';
import en from '@/messages/en.json';
import { bankSource, compileExamFixtures, itemContext, learner, MutableClock, withExamSettings } from './test-kit';
import { createMemoryExamClient } from './memory-client';

const upload = vi.hoisted(() => vi.fn());
vi.mock('@/features/media/direct-upload-client', () => ({ directUploadFile: upload }));
afterEach(() => { cleanup(); vi.clearAllMocks(); sessionStorage.clear(); });

it('carries actual UploadAnswer identity through Player and blocks submit until the upload settles', async () => {
  const { ai } = await compileExamFixtures();
  const item = withExamSettings(ai, { shuffleQuestions: false, shuffleOptions: false });
  const repo = new InMemoryExamRepo();
  const clock = new MutableClock(new Date('2026-09-02T00:00:00.000Z'));
  const service = createExamService({ repo, clock, bank: bankSource, loadItem: async () => itemContext(item), isEnrolled: async () => true });
  const client = createMemoryExamClient(service, learner, { courseId: 'ai-foundations', itemId: item.id }, clock);
  const attempt = await client.start();
  const exam = structuredClone(item.renders.en) as LearnerExam;
  exam.sections = examSections(attempt.learner);
  const rootId = exam.sections[0].questions[0].id;
  exam.sections[0].questions[0] = { id: rootId, type: 'upload_answer', accepts: ['file'], content: { blocks: [{ type: 'paragraph', content: [{ text: 'Upload your work' }] }] } } as never;
  let resolveUpload!: (value: { assetId: string; name: string; size: number; mime: string }) => void;
  upload.mockImplementation(() => new Promise(resolve => { resolveUpload = resolve; }));
  render(<NextIntlClientProvider locale="en" messages={en} timeZone="UTC"><ExamPlayer exam={exam} attempt={attempt} client={client} runtime={createPreviewRuntime(item, 'en')} onSubmitted={vi.fn()} /></NextIntlClientProvider>);
  const file = new File(['test'], 'work.pdf', { type: 'application/pdf' });
  await userEvent.upload(screen.getByLabelText('Upload files'), file);
  await waitFor(() => expect(upload).toHaveBeenCalledWith(file, expect.objectContaining({ purpose: 'submission', examAttemptId: attempt.attemptId, rootQuestionId: rootId, questionId: rootId }), expect.objectContaining({ signal: expect.any(AbortSignal) })));
  expect(screen.getByRole('button', { name: 'Submit exam' })).toBeDisabled();
  expect(screen.getByText(en.exam.player.waitForUploads)).toBeInTheDocument();
  resolveUpload({ assetId: 'asset_test', name: file.name, size: file.size, mime: file.type });
  await screen.findByText('work.pdf');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit exam' })).toBeEnabled());
});
