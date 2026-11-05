// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { UploadAnswer } from '@/content-engine/render/questions/UploadAnswer';
import type { LessonRuntime } from '@/content-engine/render/runtime';

it('passes the pinned upload question identity to the exam runtime', async () => {
  const uploadFile = vi.fn(async (file: File) => ({ assetId: 'asset-test', name: file.name, size: file.size, mime: file.type }));
  const runtime = { mode: 'learner', locale: 'en', uploadFile, resolveMedia: () => '' } as unknown as LessonRuntime;
  const question = { id: 'upload-q', type: 'upload_answer', accepts: ['file'], content: { blocks: [{ type: 'paragraph', content: [{ text: 'Upload your work' }] }] } };
  render(<UploadAnswer question={question as never} value={{}} onChange={vi.fn()} runtime={runtime} />);
  const file = new File(['example'], 'work.pdf', { type: 'application/pdf' });
  await userEvent.upload(screen.getByLabelText('Upload files'), file);
  await waitFor(() => expect(uploadFile).toHaveBeenCalledWith(file, expect.objectContaining({ questionId: 'upload-q' })));
});
