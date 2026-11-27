import 'server-only';

import { z } from 'zod';

import { ApiError } from '@/lib/api';
import { readBodyLimited } from '@/lib/body-limit';

const FILES_ORIGIN = 'https://files.vfuturelabs.org';
const MAX_RESPONSE_BYTES = 64 * 1024;
const pdfRecord = z.object({
  fileId: z.string().uuid(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  contentType: z.literal('application/pdf'),
});
const releaseId = z.string().uuid();
const serviceRelease = z.object({
  releaseId,
  status: z.enum(['draft', 'in_review', 'published', 'withdrawn']),
  releaseUrl: z.string().optional(),
});
const publicRelease = z.object({
  releaseId,
  status: z.literal('published'),
  primaryPdfId: z.string().uuid(),
  files: z.array(pdfRecord.extend({ openUrl: z.string().optional() })),
});

export function academyFilesSourceRef(resourceId: string) {
  return `academy/resource/${resourceId}`;
}

export function academyFilesReleaseUrl(resourceId: string) {
  return `${FILES_ORIGIN}/r/academy-${resourceId}/v1`;
}

export function createAcademyFilesClient({
  token = process.env.ACADEMY_FILES_SERVICE_TOKEN,
  fetcher = fetch,
}: {
  token?: string;
  fetcher?: typeof fetch;
} = {}) {
  async function read(path: string, options: RequestInit = {}, service = true): Promise<unknown> {
    if (service && (!token || !/^[!-~]{24,512}$/.test(token))) {
      throw new ApiError(503, 'FILES_UNAVAILABLE', 'The Files service is not configured');
    }
    const headers = new Headers(options.headers);
    if (service) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetcher(new URL(path, FILES_ORIGIN), {
      ...options, headers, redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(options.method === 'POST' ? 15_000 : 3_000),
    }).catch(() => { throw new ApiError(503, 'FILES_UNAVAILABLE', 'The Files service is temporarily unavailable'); });
    if (response.status === 404 && !service) return null;
    if (response.status === 429) throw new ApiError(429, 'FILES_LIMIT', 'The Files request limit was reached');
    if (!response.ok) throw new ApiError(502, 'FILES_REQUEST_FAILED', 'The Files service did not accept the request');
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBodyLimited(response, MAX_RESPONSE_BYTES))) as unknown;
    } catch {
      throw new ApiError(502, 'FILES_INVALID_RESPONSE', 'The Files service returned invalid metadata');
    }
  }

  async function validated<T>(schema: z.ZodType<T>, result: Promise<unknown>): Promise<T> {
    const parsed = schema.safeParse(await result);
    if (!parsed.success) throw new ApiError(502, 'FILES_INVALID_RESPONSE', 'The Files service returned invalid metadata');
    return parsed.data;
  }

  return {
    async upload(resourceId: string, operationId: string, file: File) {
      const body = new FormData();
      body.set('sourceRef', academyFilesSourceRef(resourceId));
      body.set('file', file);
      const result = await validated(z.object({ file: pdfRecord }), read('/api/v1/service/files', {
        method: 'POST', headers: { 'Idempotency-Key': operationId }, body,
      }));
      return result.file;
    },

    async submit(resourceId: string, operationId: string, fileId: string, title: string) {
      const result = await validated(z.object({ release: serviceRelease }), read('/api/v1/service/release-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operationId },
        body: JSON.stringify({
          sourceRef: academyFilesSourceRef(resourceId), title, slug: `academy-${resourceId}`, version: 'v1',
          author: 'VFuture Academy', fileIds: [fileId], primaryPdfId: fileId,
        }),
      }));
      return result.release;
    },

    async status(id: string) {
      const result = await validated(z.object({ release: serviceRelease }), read(`/api/v1/service/releases/${encodeURIComponent(id)}`));
      if (result.release.releaseId !== id) throw new ApiError(502, 'FILES_INVALID_RESPONSE', 'The Files service returned an unexpected release');
      return result.release;
    },

    async publishedOpenUrl(resourceId: string, id: string, fileId: string, sha256: string, sizeBytes: number) {
      const path = `/api/v1/public/releases/academy-${resourceId}/v1`;
      const result = z.object({ release: publicRelease }).safeParse(await read(path, {}, false));
      if (!result.success || result.data.release.releaseId !== id || result.data.release.primaryPdfId !== fileId) {
        return null;
      }
      const attachment = result.data.release.files.find((file) => file.fileId === fileId);
      const expectedUrl = `${FILES_ORIGIN}${path}/files/${fileId}/open`;
      return attachment?.sha256 === sha256 && attachment.sizeBytes === sizeBytes && attachment.openUrl === expectedUrl
        ? expectedUrl : null;
    },
  };
}

export type AcademyFilesClient = ReturnType<typeof createAcademyFilesClient>;
