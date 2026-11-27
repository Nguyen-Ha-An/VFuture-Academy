import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import { ResourceDocumentSchema } from '@/content-engine/schema/bundle';
import { resolveL10nString } from '@/content-engine';
import { isUploadedFile, safeMediaFilename } from '@/features/media/upload';
import { ApiError } from '@/lib/api';
import { readBodyLimited } from '@/lib/body-limit';
import { isInternalContentId } from '@/lib/internal-content';
import {
  academyFilesReleaseUrl, createAcademyFilesClient, type AcademyFilesClient,
} from './files-client';
import type { ResourceDatabase } from './service';
import { ACADEMY_FILES_RESOURCE_ID } from './files-pilot-config';

export const MAX_ACADEMY_PILOT_PDF_BYTES = 4 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_ACADEMY_PILOT_PDF_BYTES + 32 * 1024;
const TABLE = 'resource_files_pilot';
const rowSchema = z.object({
  resource_id: z.string().regex(ACADEMY_FILES_RESOURCE_ID), operation_id: z.string().uuid(),
  file_name: z.string(), size_bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/), title: z.string().max(180),
  file_id: z.string().uuid().nullable(), release_id: z.string().uuid().nullable(),
  release_url: z.string().nullable(), withdrawn: z.boolean(),
});
type PilotRow = z.infer<typeof rowSchema>;
export type ResourceFilesState = { status: 'empty' | 'uploading' | 'review' | 'published' | 'withdrawn'; url?: string };

export function isAcademyFilesPilot(id: string) {
  return ACADEMY_FILES_RESOURCE_ID.test(id) && !isInternalContentId(id) && process.env.ACADEMY_FILES_PILOT_RESOURCE_ID === id;
}

export function academyFilesWritesEnabled() {
  return process.env.ACADEMY_FILES_PILOT_WRITES_ENABLED === 'true';
}

export async function readAcademyPilotPdf(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new ApiError(415, 'FILES_PDF_REQUIRED', 'Choose one PDF to upload');
  }
  const body = await readBodyLimited(request, MAX_FORM_BYTES);
  let form: FormData;
  try {
    form = await new Response(Uint8Array.from(body), { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw new ApiError(400, 'INVALID_MULTIPART', 'The PDF upload could not be read');
  }
  const entries = [...form.entries()];
  const file = entries[0]?.[1];
  if (entries.length !== 1 || entries[0][0] !== 'file' || !isUploadedFile(file)
    || file.type !== 'application/pdf' || !/\.pdf$/i.test(file.name)) {
    throw new ApiError(415, 'FILES_PDF_REQUIRED', 'Choose one PDF to upload');
  }
  if (!file.size || file.size > MAX_ACADEMY_PILOT_PDF_BYTES) {
    throw new ApiError(413, 'FILES_PDF_SIZE', 'The pilot PDF must be between 1 byte and 4 MiB');
  }
  const header = await file.slice(0, 8).text();
  if (!/^%PDF-(1\.[0-7]|2\.0)$/.test(header)) throw new ApiError(415, 'FILES_PDF_REQUIRED', 'The selected file is not a supported PDF');
  // Canonicalize the filename before hashing the operation and calling Files so
  // that browser retries and the Files parser agree on the request fingerprint.
  return new File([file], safeMediaFilename(file.name), { type: 'application/pdf' });
}

const dbFailure = () => new ApiError(503, 'FILES_JOURNAL_UNAVAILABLE', 'The Academy PDF attachment could not be loaded or saved');
const unavailable = () => new ApiError(404, 'FILES_RESOURCE_UNAVAILABLE', 'The Academy PDF pilot is unavailable for this resource');

function persistedState(row: PilotRow | null): ResourceFilesState {
  if (!row) return { status: 'empty' };
  const url = academyFilesReleaseUrl(row.resource_id);
  if (row.withdrawn) return { status: 'withdrawn' };
  if (row.release_url === url) return { status: 'published' };
  return { status: row.release_id ? 'review' : 'uploading' };
}

export function createResourceFilesPilot(database: ResourceDatabase, files: AcademyFilesClient = createAcademyFilesClient()) {
  async function load(id: string) {
    const { data, error } = await database.from(TABLE).select('*').eq('resource_id', id).maybeSingle();
    if (error) throw dbFailure();
    if (!data) return null;
    const parsed = rowSchema.safeParse(data);
    if (!parsed.success || parsed.data.resource_id !== id) throw dbFailure();
    return parsed.data;
  }

  async function currentPublicResource(id: string) {
    const result = await database.from('resources').select('id,document,status,branch_scope,ownership_kind')
      .eq('id', id).eq('status', 'published').eq('branch_scope->>scope', 'global')
      .eq('ownership_kind', 'central').maybeSingle();
    if (result.error) throw dbFailure();
    const row = z.object({
      id: z.string(), document: ResourceDocumentSchema, status: z.literal('published'),
      branch_scope: z.object({ scope: z.literal('global') }), ownership_kind: z.literal('central'),
    }).safeParse(result.data);
    if (!row.success || row.data.id !== id || row.data.document.id !== id
      || (row.data.document.branchScope && row.data.document.branchScope.scope !== 'global')) throw unavailable();
    return row.data.document;
  }

  async function checkpoint(row: PilotRow, patch: Partial<Pick<PilotRow, 'file_id' | 'release_id' | 'release_url' | 'withdrawn'>>) {
    const { data, error } = await database.from(TABLE).update(patch)
      .eq('resource_id', row.resource_id).eq('operation_id', row.operation_id).select('*').maybeSingle();
    const parsed = rowSchema.safeParse(data);
    if (error || !parsed.success || parsed.data.resource_id !== row.resource_id
      || parsed.data.operation_id !== row.operation_id) throw dbFailure();
    return parsed.data;
  }

  async function verifiedOpenUrl(id: string, row: PilotRow) {
    if (row.withdrawn || !row.release_id || !row.file_id) return null;
    const url = await files.publishedOpenUrl(id, row.release_id, row.file_id, row.sha256, row.size_bytes);
    if (url) await currentPublicResource(id);
    return url;
  }

  async function sync(id: string, row: PilotRow): Promise<ResourceFilesState> {
    if (!row.release_id || !row.file_id) return persistedState(row);
    const release = await files.status(row.release_id);
    if (release.status === 'published') {
      const releaseUrl = academyFilesReleaseUrl(id);
      const url = release.releaseUrl === releaseUrl ? await verifiedOpenUrl(id, row) : null;
      if (!url) throw new ApiError(502, 'FILES_INVALID_PUBLICATION', 'The public Files release could not be verified');
      if (row.release_url !== releaseUrl) await checkpoint(row, { release_url: releaseUrl, withdrawn: false });
      return { status: 'published', url };
    }
    const withdrawn = release.status === 'withdrawn';
    if (row.release_url || withdrawn !== row.withdrawn) await checkpoint(row, { release_url: null, withdrawn });
    return { status: withdrawn ? 'withdrawn' : 'review' };
  }

  return {
    async status(id: string) {
      if (!isAcademyFilesPilot(id)) throw unavailable();
      await currentPublicResource(id);
      const row = await load(id);
      const state = persistedState(row);
      if (!row || state.status !== 'published') return state;
      const url = await verifiedOpenUrl(id, row).catch(() => null);
      return url ? { ...state, url } : state;
    },

    async refresh(id: string) {
      if (!isAcademyFilesPilot(id)) throw unavailable();
      await currentPublicResource(id);
      const row = await load(id);
      return row ? sync(id, row) : persistedState(null);
    },

    async submit(id: string, actorId: string, file: File): Promise<ResourceFilesState> {
      if (!isAcademyFilesPilot(id) || !academyFilesWritesEnabled()) throw unavailable();
      const resource = await currentPublicResource(id);
      const sha256 = createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
      let row = await load(id);
      if (!row) {
        const locale = resource.defaultLanguage ?? resource.languages?.[0] ?? 'vi';
        const title = (resolveL10nString(resource.title, locale, locale).trim() || id).slice(0, 180);
        const { data, error } = await database.from(TABLE).insert({
          resource_id: id, operation_id: randomUUID(), created_by: actorId, file_name: file.name,
          size_bytes: file.size, sha256, title,
        }).select('*').maybeSingle();
        if (error && (error as { code?: string }).code !== '23505') throw dbFailure();
        if (error) row = await load(id);
        else {
          const parsed = rowSchema.safeParse(data);
          if (parsed.success) row = parsed.data;
        }
        if (!row || row.resource_id !== id) throw dbFailure();
      }
      if (row.sha256 !== sha256 || row.size_bytes !== file.size || row.file_name !== file.name) {
        throw new ApiError(409, 'FILES_PILOT_CONFLICT', 'Resume this pilot with the original PDF and filename');
      }
      if (row.release_id) return sync(id, row);
      let fileId = row.file_id;
      if (!fileId) {
        const uploaded = await files.upload(id, row.operation_id, file);
        if (uploaded.sha256 !== row.sha256 || uploaded.sizeBytes !== row.size_bytes) {
          throw new ApiError(502, 'FILES_DIGEST_MISMATCH', 'The stored Files PDF could not be verified');
        }
        row = await checkpoint(row, { file_id: uploaded.fileId });
        fileId = uploaded.fileId;
      }
      // A permission-preserving change to the resource while the bytes were
      // uploading can leave a private file, but cannot submit a public review.
      await currentPublicResource(id);
      const release = await files.submit(id, row.operation_id, fileId, row.title);
      row = await checkpoint(row, { release_id: release.releaseId });
      return release.status === 'in_review' ? { status: 'review' } : sync(id, row);
    },

    async publicUrl(id: string) {
      if (!isAcademyFilesPilot(id)) return null;
      try {
        await currentPublicResource(id);
        const row = await load(id);
        return row && persistedState(row).status === 'published' ? await verifiedOpenUrl(id, row) : null;
      } catch {
        // A provider outage should hide the new attachment without suppressing
        // the existing public resource or any of its legacy attachments.
        return null;
      }
    },
  };
}
