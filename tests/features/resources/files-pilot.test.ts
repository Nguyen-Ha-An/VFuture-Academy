import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { academyFilesReleaseUrl, createAcademyFilesClient, type AcademyFilesClient } from '@/features/resources/files-client';
import { createResourceFilesPilot, MAX_ACADEMY_PILOT_PDF_BYTES, readAcademyPilotPdf } from '@/features/resources/files-pilot';
import type { ResourceDatabase } from '@/features/resources/service';

vi.mock('server-only', () => ({}));

const id = 'teacher-guide';
const fileId = '691c18e5-628a-48af-8a50-c07025e8a401';
const releaseId = '8da323be-4f38-42f4-8d75-95fc817ba84a';
const directUrl = `https://files.vfuturelabs.org/api/v1/public/releases/academy-${id}/v1/files/${fileId}/open`;
const actorId = 'b3c8ca6f-2f4e-4c65-af15-48c13a7fba0c';
const contents = '%PDF-1.4\n% synthetic PDF fixture\n%%EOF';
const file = new File([contents], 'guide.pdf', { type: 'application/pdf' });
const digest = createHash('sha256').update(contents).digest('hex');
const doc = {
  schemaVersion: 1, kind: 'resource', id, title: 'Teacher guide', summary: 'Synthetic guide', resourceType: 'guide',
  body: { blocks: [{ type: 'paragraph', content: [{ text: 'Synthetic guide' }] }] },
  branchScope: { scope: 'global' },
};

function fixtureDatabase() {
  let journal: Record<string, unknown> | null = null;
  const source: Record<string, unknown> = {
    id, document: doc, status: 'published', branch_scope: { scope: 'global' }, ownership_kind: 'central',
  };
  return {
    database: {
      from(table: string) {
        const conditions = new Map<string, unknown>();
        let insertion: Record<string, unknown> | undefined;
        let update: Record<string, unknown> | undefined;
        return {
          select() { return this; },
          eq(column: string, value: unknown) { conditions.set(column, value); return this; },
          insert(value: Record<string, unknown>) { insertion = value; return this; },
          update(value: Record<string, unknown>) { update = value; return this; },
          async maybeSingle() {
            if (table === 'resources') {
              return { data: conditions.get('id') === id && source.status === 'published' ? { ...source } : null, error: null };
            }
            if (table !== 'resource_files_pilot') throw Error('Unexpected table: ' + table);
            if (insertion) {
              if (journal) return { data: null, error: { code: '23505' } };
              journal = { file_id: null, release_id: null, release_url: null, withdrawn: false, ...insertion };
            }
            if (update && journal && conditions.get('resource_id') === journal.resource_id
              && conditions.get('operation_id') === journal.operation_id) journal = { ...journal, ...update };
            return { data: journal ? { ...journal } : null, error: null };
          },
        };
      },
    } as unknown as ResourceDatabase,
    source,
    journal: () => journal,
  };
}

function fixtureClient() {
  return {
    upload: vi.fn<AcademyFilesClient['upload']>(async () => ({ fileId, sizeBytes: file.size, sha256: digest, contentType: 'application/pdf' })),
    submit: vi.fn<AcademyFilesClient['submit']>(async () => ({ releaseId, status: 'in_review' })),
    status: vi.fn<AcademyFilesClient['status']>(async () => ({ releaseId, status: 'in_review' })),
    publishedOpenUrl: vi.fn<AcademyFilesClient['publishedOpenUrl']>(async () => null),
  };
}

describe('Academy Files resource pilot', () => {
  beforeEach(() => {
    vi.stubEnv('ACADEMY_FILES_PILOT_RESOURCE_ID', id);
    vi.stubEnv('ACADEMY_FILES_PILOT_WRITES_ENABLED', 'true');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('records the operation before sending bytes and resumes both lost responses using the same operation ID', async () => {
    const data = fixtureDatabase();
    const files = fixtureClient();
    files.upload.mockImplementationOnce(async (_id, operationId) => {
      expect(data.journal()?.operation_id).toBe(operationId);
      throw new Error('Upload response lost');
    });
    files.submit.mockImplementationOnce(async (_id, operationId) => {
      expect(data.journal()?.operation_id).toBe(operationId);
      expect(data.journal()?.file_id).toBe(fileId);
      throw new Error('Review response lost');
    });
    const pilot = createResourceFilesPilot(data.database, files);
    await expect(pilot.submit(id, actorId, file)).rejects.toThrow('Upload response lost');
    await expect(pilot.submit(id, actorId, file)).rejects.toThrow('Review response lost');
    await expect(pilot.submit(id, actorId, file)).resolves.toEqual({ status: 'review' });
    expect(files.upload.mock.calls.map(([, operation]) => operation)).toEqual([data.journal()?.operation_id, data.journal()?.operation_id]);
    expect(files.submit.mock.calls.map(([, operation]) => operation)).toEqual([data.journal()?.operation_id, data.journal()?.operation_id]);
    await expect(pilot.submit(id, actorId, new File([contents + ' altered'], 'guide.pdf', { type: 'application/pdf' })))
      .rejects.toMatchObject({ status: 409, code: 'FILES_PILOT_CONFLICT' });
    expect(files.upload).toHaveBeenCalledTimes(2);
  });

  it('limits writes to the configured Central-owned public resource and defaults to disabled', async () => {
    const data = fixtureDatabase();
    const files = fixtureClient();
    const pilot = createResourceFilesPilot(data.database, files);
    vi.stubEnv('ACADEMY_FILES_PILOT_WRITES_ENABLED', '');
    await expect(pilot.submit(id, actorId, file)).rejects.toMatchObject({ status: 404 });
    vi.stubEnv('ACADEMY_FILES_PILOT_WRITES_ENABLED', 'true');
    await expect(pilot.submit('different-guide', actorId, file)).rejects.toMatchObject({ status: 404 });
    data.source.ownership_kind = 'branch';
    await expect(pilot.submit(id, actorId, file)).rejects.toMatchObject({ status: 404 });
    expect(data.journal()).toBeNull();
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('adds the public link only after a matching release and preserves reads with writes disabled', async () => {
    const data = fixtureDatabase();
    const files = fixtureClient();
    const pilot = createResourceFilesPilot(data.database, files);
    await pilot.submit(id, actorId, file);
    await expect(pilot.publicUrl(id)).resolves.toBeNull();
    expect(files.publishedOpenUrl).not.toHaveBeenCalled();
    files.status.mockResolvedValue({ releaseId, status: 'published', releaseUrl: 'https://example.test/r/academy-teacher-guide/v1' });
    await expect(pilot.refresh(id)).rejects.toMatchObject({ code: 'FILES_INVALID_PUBLICATION' });
    expect(data.journal()?.release_url).toBeNull();
    const url = academyFilesReleaseUrl(id);
    files.status.mockResolvedValue({ releaseId, status: 'published', releaseUrl: url });
    files.publishedOpenUrl.mockResolvedValue(directUrl);
    vi.stubEnv('ACADEMY_FILES_PILOT_WRITES_ENABLED', 'false');
    await expect(pilot.refresh(id)).resolves.toEqual({ status: 'published', url: directUrl });
    expect(data.journal()?.release_url).toBe(url);
    await expect(pilot.status(id)).resolves.toEqual({ status: 'published', url: directUrl });
    await expect(pilot.publicUrl(id)).resolves.toBe(directUrl);
    expect(files.publishedOpenUrl).toHaveBeenLastCalledWith(id, releaseId, fileId, digest, file.size);
    files.publishedOpenUrl.mockResolvedValue(null);
    await expect(pilot.status(id)).resolves.toEqual({ status: 'published' });
    await expect(pilot.publicUrl(id)).resolves.toBeNull();
    files.status.mockResolvedValue({ releaseId, status: 'withdrawn' });
    await expect(pilot.refresh(id)).resolves.toEqual({ status: 'withdrawn' });
    expect(data.journal()?.release_url).toBeNull();
  });

  it('hides the Files link when either side is unavailable or Academy withdraws the resource', async () => {
    const data = fixtureDatabase();
    const files = fixtureClient();
    const pilot = createResourceFilesPilot(data.database, files);
    await pilot.submit(id, actorId, file);
    files.status.mockResolvedValue({ releaseId, status: 'published', releaseUrl: academyFilesReleaseUrl(id) });
    files.publishedOpenUrl.mockResolvedValue(directUrl);
    await pilot.refresh(id);
    files.publishedOpenUrl.mockRejectedValueOnce(new Error('Files offline'));
    await expect(pilot.publicUrl(id)).resolves.toBeNull();
    files.publishedOpenUrl.mockClear();
    data.source.status = 'draft';
    await expect(pilot.publicUrl(id)).resolves.toBeNull();
    expect(files.publishedOpenUrl).not.toHaveBeenCalled();
  });

  it('rechecks Academy publication after the Files lookup', async () => {
    const data = fixtureDatabase();
    const files = fixtureClient();
    const pilot = createResourceFilesPilot(data.database, files);
    await pilot.submit(id, actorId, file);
    files.status.mockResolvedValue({ releaseId, status: 'published', releaseUrl: academyFilesReleaseUrl(id) });
    files.publishedOpenUrl.mockResolvedValue(directUrl);
    await pilot.refresh(id);
    files.publishedOpenUrl.mockImplementationOnce(async () => {
      data.source.status = 'draft';
      return directUrl;
    });
    await expect(pilot.publicUrl(id)).resolves.toBeNull();
  });

  it('requires an actual PDF and enforces the hosted request size ceiling', async () => {
    const requestFor = (value: File) => {
      const form = new FormData();
      form.set('file', value);
      return new Request('https://academy.example/files', { method: 'POST', body: form });
    };
    await expect(readAcademyPilotPdf(requestFor(file))).resolves.toMatchObject({ name: file.name, size: file.size });
    await expect(readAcademyPilotPdf(requestFor(new File(['plain text'], 'bad.pdf', { type: 'application/pdf' }))))
      .rejects.toMatchObject({ status: 415 });
    await expect(readAcademyPilotPdf(requestFor(new File([new Uint8Array(MAX_ACADEMY_PILOT_PDF_BYTES + 1)], 'large.pdf', { type: 'application/pdf' }))))
      .rejects.toMatchObject({ status: 413 });
  });
});

describe('Academy Files client', () => {
  it('uses the fixed origin, sends scoped metadata, and omits the service token from public checks', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ file: { fileId, sizeBytes: file.size, sha256: digest, contentType: 'application/pdf' } }))
      .mockResolvedValueOnce(Response.json({ release: { releaseId, status: 'in_review' } }))
      .mockResolvedValueOnce(Response.json({ release: { releaseId, status: 'published', primaryPdfId: fileId, files: [
        { fileId, sizeBytes: file.size, sha256: digest, contentType: 'application/pdf', openUrl: directUrl },
      ] } }));
    const token = 'synthetic-stage2-test-credential';
    const client = createAcademyFilesClient({ token, fetcher });
    await client.upload(id, actorId, file);
    await client.submit(id, actorId, fileId, 'Teacher guide');
    await expect(client.publishedOpenUrl(id, releaseId, fileId, digest, file.size)).resolves.toBe(directUrl);
    const [[uploadUrl, uploadOptions], [submitUrl, submitOptions], [publicUrl, publicOptions]] = fetcher.mock.calls;
    expect(String(uploadUrl)).toBe('https://files.vfuturelabs.org/api/v1/service/files');
    expect(new Headers(uploadOptions?.headers).get('Authorization')).toBe('Bearer ' + token);
    expect(new Headers(uploadOptions?.headers).get('Idempotency-Key')).toBe(actorId);
    expect((uploadOptions?.body as FormData).get('sourceRef')).toBe('academy/resource/teacher-guide');
    expect(String(submitUrl)).toBe('https://files.vfuturelabs.org/api/v1/service/release-drafts');
    expect(JSON.parse(String(submitOptions?.body))).toMatchObject({ slug: 'academy-teacher-guide', version: 'v1', primaryPdfId: fileId });
    expect(String(publicUrl)).toBe('https://files.vfuturelabs.org/api/v1/public/releases/academy-teacher-guide/v1');
    expect(new Headers(publicOptions?.headers).has('Authorization')).toBe(false);
    expect(publicOptions).toMatchObject({ redirect: 'error', cache: 'no-store' });
  });

  it.each([
    ['missing openUrl', {}, { openUrl: undefined }],
    ['foreign origin', {}, { openUrl: directUrl.replace('files.vfuturelabs.org', 'files.example.test') }],
    ['different path', {}, { openUrl: directUrl.replace('/open', '/download') }],
    ['query string', {}, { openUrl: directUrl + '?extra=1' }],
    ['different release ID', { releaseId: actorId }, {}],
    ['different primary PDF', { primaryPdfId: actorId }, {}],
    ['different file ID', {}, { fileId: actorId }],
    ['different checksum', {}, { sha256: 'a'.repeat(64) }],
    ['different byte length', {}, { sizeBytes: file.size + 1 }],
    ['different MIME type', {}, { contentType: 'image/png' }],
    ['withdrawn release', { status: 'withdrawn' }, {}],
  ] as const)('rejects published metadata with %s', async (_description, releasePatch, filePatch) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      release: {
        releaseId, status: 'published', primaryPdfId: fileId, ...releasePatch,
        files: [{ fileId, sizeBytes: file.size, sha256: digest, contentType: 'application/pdf', openUrl: directUrl, ...filePatch }],
      },
    }));
    const client = createAcademyFilesClient({ fetcher });
    await expect(client.publishedOpenUrl(id, releaseId, fileId, digest, file.size)).resolves.toBeNull();
  });
});
