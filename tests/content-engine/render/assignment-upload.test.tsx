import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssignmentPayload, LessonRuntime } from '@/content-engine/render/runtime';
import { SubmissionFields } from '@/content-engine/render/questions/UploadAnswer';

function runtime(uploadAssignmentFile: LessonRuntime['uploadAssignmentFile']): LessonRuntime {
  return {
    mode: 'learner', locale: 'en',
    getBlockState: () => undefined,
    setBlockState: () => undefined,
    getAssignmentSession: () => undefined,
    refreshAssignmentSession: vi.fn(),
    submitQuiz: vi.fn(), checkQuestion: vi.fn(), submitAssignment: vi.fn(),
    uploadAssignmentFile,
    uploadFile: vi.fn(),
    resolveMedia: () => '', hrefFor: () => '', markViewed: () => undefined, onActivityComplete: () => undefined,
  };
}

function Harness({ runtime: rt, hosts, accepts = ['file', 'link', 'text'] }: { runtime: LessonRuntime; hosts?: string[]; accepts?: string[] }) {
  const [value, setValue] = useState<AssignmentPayload>({});
  return (
    <SubmissionFields
      accepts={accepts}
      value={value}
      onChange={setValue}
      runtime={rt}
      assignmentTarget={{ blockId: 'inline-work' }}
      linkHosts={hosts}
    />
  );
}

describe('assignment submission fields', () => {
  it('keeps each renderer transaction pending until its file and concurrent sibling text are committed', async () => {
    const pending = new Map<string, (value: { assetId: string; name: string; size: number; mime: string }) => void>();
    const upload = vi.fn<LessonRuntime['uploadAssignmentFile']>((_target, file) => new Promise(resolve => { pending.set(file.name, resolve); }));
    const signals: Array<{ delta: number; answer: AssignmentPayload }> = [];
    const busy: boolean[] = [];
    let latest: AssignmentPayload = {};
    const rt = { ...runtime(upload), onAnswerUploadPending: (delta: 1 | -1) => signals.push({ delta, answer: structuredClone(latest) }) };
    function Field() {
      const [value, setValue] = useState<AssignmentPayload>({});
      return <SubmissionFields accepts={['file', 'text']} value={value} onChange={next => { latest = next; setValue(next); }} runtime={rt} assignmentTarget={{ blockId: 'inline-work' }} onUploadBusyChange={value => busy.push(value)} />;
    }
    render(<Field />);
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Upload files'), [new File(['one'], 'one.pdf', { type: 'application/pdf' }), new File(['two'], 'two.pdf', { type: 'application/pdf' })]);
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Sibling text');
    expect(signals.map(signal => signal.delta)).toEqual([1, 1]);
    await act(async () => pending.get('two.pdf')!({ assetId: 'asset_two', name: 'two.pdf', size: 3, mime: 'application/pdf' }));
    await waitFor(() => expect(signals.map(signal => signal.delta)).toEqual([1, 1, -1]));
    expect(signals[2].answer).toMatchObject({ text: 'Sibling text', files: [{ assetId: 'asset_two' }] });
    expect(busy.at(-1)).toBe(true);
    await act(async () => pending.get('one.pdf')!({ assetId: 'asset_one', name: 'one.pdf', size: 3, mime: 'application/pdf' }));
    await waitFor(() => expect(signals.map(signal => signal.delta)).toEqual([1, 1, -1, -1]));
    expect(signals[3].answer.text).toBe('Sibling text');
    expect(signals[3].answer.files?.map(file => file.assetId)).toEqual(['asset_two', 'asset_one']);
    expect(busy.at(-1)).toBe(false);
  });

  it('opens a saved attachment through the runtime media route without replacing the active page', async () => {
    const resolveMedia = vi.fn(() => '/api/v1/media/asset_saved');
    const rt = { ...runtime(vi.fn()), resolveMedia };
    const file = { assetId: 'asset_saved', name: 'work.pdf', size: 2048, mime: 'application/pdf' };
    const onChange = vi.fn();
    const { rerender } = render(<SubmissionFields accepts={['file']} value={{ files: [file] }} onChange={onChange} runtime={rt} />);
    const link = screen.getByRole('link', { name: 'work.pdf' });
    expect(link).toHaveAttribute('href', '/api/v1/media/asset_saved');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(resolveMedia).toHaveBeenCalledWith({ assetId: 'asset_saved' });
    expect(screen.getByText('(2 KB)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'remove' }));
    expect(onChange).toHaveBeenCalledWith({ files: [] });
    rerender(<SubmissionFields accepts={['file']} value={{ files: [file] }} onChange={onChange} runtime={rt} disabled />);
    expect(screen.getByRole('link', { name: 'work.pdf' })).toHaveAttribute('href', '/api/v1/media/asset_saved');
    expect(screen.queryByRole('button', { name: 'remove' })).not.toBeInTheDocument();
  });

  it('renders only the input channels permitted by the published assignment', () => {
    render(<Harness runtime={runtime(vi.fn())} accepts={['text']} />);

    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Upload files')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Link URL' })).not.toBeInTheDocument();
  });

  it('retains successful sibling uploads and retries a failed file with progress', async () => {
    let retrySucceeds = false;
    const upload = vi.fn<LessonRuntime['uploadAssignmentFile']>(async (target, file, options) => {
      expect(target).toEqual({ blockId: 'inline-work' });
      options?.onProgress?.({ loaded: 2, total: 4, percent: 50 });
      if (file.name === 'bad.pdf' && !retrySucceeds) throw new Error('offline');
      return { assetId: `asset-${file.name}`, name: file.name, size: file.size, mime: file.type };
    });
    const user = userEvent.setup();
    render(<Harness runtime={runtime(upload)} />);

    const input = screen.getByLabelText('Upload files');
    await user.upload(input, [
      new File(['good'], 'good.pdf', { type: 'application/pdf' }),
      new File(['bad!'], 'bad.pdf', { type: 'application/pdf' }),
    ]);

    expect(await screen.findByText('good.pdf')).toBeInTheDocument();
    expect(screen.getByText('Upload failed for bad.pdf')).toBeInTheDocument();
    retrySucceeds = true;
    await user.click(screen.getByRole('button', { name: 'Retry bad.pdf' }));

    expect(await screen.findByText('bad.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Upload failed for bad.pdf')).not.toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('shows actual progress and lets the learner cancel an in-flight file', async () => {
    const upload = vi.fn<LessonRuntime['uploadAssignmentFile']>((_target, file, options) => new Promise((_resolve, reject) => {
      options?.onProgress?.({ loaded: 1, total: file.size, percent: 25 });
      options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'UPLOAD_CANCELLED' })));
    }));
    const user = userEvent.setup();
    render(<Harness runtime={runtime(upload)} />);

    await user.upload(screen.getByLabelText('Upload files'), new File(['work'], 'work.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('progressbar', { name: 'Upload progress for work.pdf' })).toHaveAttribute('aria-valuenow', '25');
    await user.click(screen.getByRole('button', { name: 'Cancel work.pdf' }));

    expect(await screen.findByText('Upload cancelled for work.pdf')).toBeInTheDocument();
    expect(screen.queryByText('work.pdf', { selector: 'a' })).not.toBeInTheDocument();
  });

  it('does not mark an upload successful before the response or overwrite concurrent text edits', async () => {
    let finish!: (file: { assetId: string; name: string; size: number; mime: string }) => void;
    const response = new Promise<{ assetId: string; name: string; size: number; mime: string }>((resolve) => { finish = resolve; });
    const upload = vi.fn<LessonRuntime['uploadAssignmentFile']>(() => response);
    const user = userEvent.setup();
    render(<Harness runtime={runtime(upload)} />);

    await user.upload(screen.getByLabelText('Upload files'), new File(['work'], 'work.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('button', { name: 'Cancel work.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'remove' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Keep this text');

    finish({ assetId: 'asset-work', name: 'work.pdf', size: 4, mime: 'application/pdf' });
    expect(await screen.findByRole('button', { name: 'remove' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Keep this text');
  });

  it('uses shared empty-host and wildcard semantics for links', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness runtime={runtime(vi.fn())} hosts={[]} />);
    await user.type(screen.getByLabelText('Link URL'), 'https://docs.example.com/work');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Link must use HTTPS and an allowed host');

    rerender(<Harness runtime={runtime(vi.fn())} hosts={['*.example.com']} />);
    await user.clear(screen.getByLabelText('Link URL'));
    await user.type(screen.getByLabelText('Link URL'), 'https://example.com/work');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Link URL'));
    await user.type(screen.getByLabelText('Link URL'), 'https://docs.example.com/work');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(screen.getByRole('link', { name: 'https://docs.example.com/work' })).toBeInTheDocument();
  });
});
