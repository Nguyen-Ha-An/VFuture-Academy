import { describe, expect, it } from 'vitest';

import {
  collectNotebookDependencies,
  sanitizeNotebookTemplate,
  validateNotebookDependencies,
  validateNotebookDocument,
  validateNotebookSubmissionArtifact,
} from '@/features/notebooks/contracts';

const checksum = (digit: string) => digit.repeat(64);

describe('notebook document contracts', () => {
  it('accepts nbformat 4 code, markdown, and raw cells without rewriting source arrays', () => {
    const source = ['print("hello")\n', 'print("world")'];
    const parsed = validateNotebookDocument({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { name: 'python', display_name: 'Python' } },
      cells: [
        { id: 'intro', cell_type: 'markdown', metadata: {}, source: '# Intro' },
        { cell_type: 'code', metadata: {}, source, execution_count: 3, outputs: [{ output_type: 'stream', text: 'hello' }] },
        { cell_type: 'raw', metadata: {}, source: ['raw'] },
      ],
    });

    expect(parsed.cells[1].source).toEqual(source);
  });

  it('rejects non-v4 notebooks and unknown cell types', () => {
    expect(() => validateNotebookDocument({ nbformat: 3, nbformat_minor: 0, metadata: {}, cells: [] })).toThrow();
    expect(() => validateNotebookDocument({
      nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{ cell_type: 'heading', metadata: {}, source: 'x' }],
    })).toThrow();
  });

  it('strips outputs, execution counts, and trusted metadata without truncating source', () => {
    const longSource = `# ${'x'.repeat(100_000)}`;
    const sanitized = sanitizeNotebookTemplate({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { trusted: true, kernelspec: { name: 'python' } },
      cells: [
        { cell_type: 'code', metadata: { trusted: true }, source: longSource, execution_count: 9, outputs: [{ output_type: 'execute_result', data: { 'text/plain': 'secret' } }] },
      ],
    });

    expect(sanitized.cells).toHaveLength(1);
    expect(sanitized.cells[0]).toMatchObject({ cell_type: 'code', source: longSource, execution_count: null, outputs: [] });
    expect(sanitized.cells[0].metadata).not.toHaveProperty('trusted');
    expect(sanitized.metadata).not.toHaveProperty('trusted');
  });

  it('rejects author-only solution cells instead of silently deleting source', () => {
    expect(() => sanitizeNotebookTemplate({
      nbformat: 4, nbformat_minor: 5, metadata: {},
      cells: [{ cell_type: 'markdown', metadata: { tags: ['solution'] }, source: 'secret' }],
    })).toThrow('hidden solution');
  });
});

describe('notebook dependency contracts', () => {
  const config = {
    runtimeMode: 'jupyterlite' as const,
    templateAssetId: 'template-1',
    templateChecksum: checksum('a'),
    runtimeProfileId: 'python-data-v1' as const,
    runtimeProfileVersion: '1' as const,
    datasets: [
      { assetId: 'dataset-1', checksum: checksum('b'), filename: 'sales.csv' },
      { assetId: 'dataset-2', checksum: checksum('c'), filename: 'config.json' },
    ],
  };

  it('collects the immutable template and dataset snapshot for Central review', () => {
    expect(collectNotebookDependencies(config)).toEqual([
      { kind: 'template', assetId: 'template-1', checksum: checksum('a'), filename: undefined, runtimeProfileId: 'python-data-v1', runtimeProfileVersion: '1' },
      { kind: 'dataset', assetId: 'dataset-1', checksum: checksum('b'), filename: 'sales.csv', runtimeProfileId: 'python-data-v1', runtimeProfileVersion: '1' },
      { kind: 'dataset', assetId: 'dataset-2', checksum: checksum('c'), filename: 'config.json', runtimeProfileId: 'python-data-v1', runtimeProfileVersion: '1' },
    ]);
  });

  it('enforces template MIME and dataset per-file and aggregate limits from trusted snapshots', () => {
    expect(validateNotebookDependencies(config, [
      { assetId: 'template-1', checksum: checksum('a'), filename: 'starter.ipynb', mime: 'application/x-ipynb+json', sizeBytes: 1 },
      { assetId: 'dataset-1', checksum: checksum('b'), filename: 'sales.csv', mime: 'text/csv', sizeBytes: 10 * 1024 * 1024 },
      { assetId: 'dataset-2', checksum: checksum('c'), filename: 'config.json', mime: 'application/json', sizeBytes: 10 * 1024 * 1024 },
    ])).toEqual([]);

    expect(validateNotebookDependencies(config, [
      { assetId: 'template-1', checksum: checksum('a'), filename: 'starter.ipynb', mime: 'text/plain', sizeBytes: 1 },
      { assetId: 'dataset-1', checksum: checksum('b'), filename: 'sales.csv', mime: 'text/csv', sizeBytes: 10 * 1024 * 1024 + 1 },
      { assetId: 'dataset-2', checksum: checksum('x'), filename: 'config.json', mime: 'application/json', sizeBytes: 1 },
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: 'template-1', code: 'mime_mismatch' }),
      expect.objectContaining({ assetId: 'dataset-1', code: 'file_too_large' }),
      expect.objectContaining({ assetId: 'dataset-2', code: 'checksum_mismatch' }),
    ]));
  });
});

describe('notebook submission artifact provenance', () => {
  const expected = {
    ownerId: 'learner-1', courseId: 'course-1', courseVersionId: 'version-1', itemId: 'assignment-1', blockId: null,
    templateAssetId: 'template-1', templateChecksum: checksum('a'), runtimeProfileId: 'python-data-v1', runtimeProfileVersion: '1',
  };

  it('accepts only a ready submission bound to the actual learner and assignment target', () => {
    const artifact = {
      id: 'artifact-1', ownerId: 'learner-1', courseId: 'course-1', courseVersionId: 'version-1', itemId: 'assignment-1', blockId: null,
      purpose: 'submission' as const, status: 'ready' as const, checksum: checksum('d'), templateAssetId: 'template-1',
      templateChecksum: checksum('a'), runtimeProfileId: 'python-data-v1', runtimeProfileVersion: '1', sizeBytes: 5 * 1024 * 1024,
      mime: 'application/x-ipynb+json', filename: 'work.ipynb', storagePath: 'learner-1/work.ipynb',
    };

    expect(validateNotebookSubmissionArtifact(artifact, expected)).toEqual([]);
    expect(validateNotebookSubmissionArtifact({ ...artifact, checksum: checksum('a') }, expected)).toEqual([]);
    expect(validateNotebookSubmissionArtifact({ ...artifact, ownerId: 'other' }, expected))
      .toContainEqual(expect.objectContaining({ code: 'provenance_mismatch', field: 'ownerId' }));
  });

  it('rejects oversized, non-notebook, pending, and draft artifacts', () => {
    const artifact = {
      id: 'artifact-1', ownerId: 'learner-1', courseId: 'course-1', courseVersionId: 'version-1', itemId: 'assignment-1', blockId: null,
      purpose: 'draft' as const, status: 'pending' as const, checksum: checksum('d'), templateAssetId: 'template-1',
      templateChecksum: checksum('a'), runtimeProfileId: 'python-data-v1', runtimeProfileVersion: '1', sizeBytes: 5 * 1024 * 1024 + 1,
      mime: 'application/json', filename: 'work.json', storagePath: 'learner-1/work.json',
    };

    expect(validateNotebookSubmissionArtifact(artifact, expected).map(({ code }) => code)).toEqual(expect.arrayContaining([
      'purpose_mismatch', 'status_mismatch', 'file_too_large', 'mime_mismatch', 'filename_mismatch',
    ]));
  });
});

it.each([{nbgrader:{solution:true}},{vfuture:{instructorOnly:true}},{jupyter:{hiddenSolution:true}}])('rejects author-only nested notebook metadata %j',metadata=>{
 expect(()=>sanitizeNotebookTemplate({nbformat:4,nbformat_minor:5,metadata:{},cells:[{id:'solution',cell_type:'code',metadata,source:'answer = 42',outputs:[],execution_count:null}]})).toThrow(/solution|author-only/);
});
