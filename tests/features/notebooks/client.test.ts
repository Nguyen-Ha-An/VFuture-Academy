// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  NotebookApiError,
  notebookApi,
  notebookJson,
  uploadNotebookFile,
} from '@/features/notebooks/client';

afterEach(() => vi.restoreAllMocks());

describe('notebook client boundary', () => {
  it('keeps a null block identity absent from URLs and never sends app credentials to the signed upload origin', async () => {
    const responses = [
      new Response(JSON.stringify({ data: { id: 'artifact-1', url: 'https://storage.example/signed', mime: 'application/x-ipynb+json' } }), { status: 200 }),
      new Response('', { status: 200 }),
      new Response(JSON.stringify({ data: { id: 'artifact-1', checksum: 'a'.repeat(64), filename: 'work.ipynb', size_bytes: 2, runtime_profile_id: 'python-data-v1', runtime_profile_version: '1' } }), { status: 200 }),
    ];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses.shift()!);

    await uploadNotebookFile(
      { courseId: 'course-1', itemId: 'assignment-1', blockId: null },
      false,
      new Blob(['{}'], { type: 'application/x-ipynb+json' }),
      'work.ipynb',
      'draft',
      'learner-1',
    );

    expect(fetchMock.mock.calls[0][0]).not.toContain('blockId');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Notebook-Actor')).toBe('learner-1');
    expect(fetchMock.mock.calls[1][0]).toBe('https://storage.example/signed');
    const signedHeaders = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(signedHeaders.has('authorization')).toBe(false);
    expect(signedHeaders.has('cookie')).toBe(false);
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('X-Notebook-Actor')).toBe('learner-1');
  });

  it('normalizes non-JSON API failures into a typed error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('gateway failed', { status: 502 }));
    await expect(notebookJson('/api/v1/notebooks/session')).rejects.toEqual(expect.objectContaining({
      name: 'NotebookApiError', code: 'NOTEBOOK_ERROR', status: 502,
    }));
  });

  it('encodes an explicit inline block identity only when present', () => {
    expect(notebookApi({ courseId: 'course-1', itemId: 'lesson-1', blockId: null }, false, 'session')).not.toContain('blockId');
    expect(notebookApi({ courseId: 'course-1', itemId: 'lesson-1', blockId: 'task-1' }, false, 'session')).toContain('blockId=task-1');
    expect(new NotebookApiError('X', 'message', 409).status).toBe(409);
  });
});
