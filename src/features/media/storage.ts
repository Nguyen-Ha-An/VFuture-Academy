import 'server-only';

import { disableTypes, imageSize } from 'image-size';

import { ApiError } from '@/lib/api';
import type { Actor } from '@/lib/permissions';
import {
  MEDIA_BUCKET,
  mediaAssetId,
  mediaMimeForFilename,
  mediaUploadMetadata,
} from '@/features/media/upload';
import { mediaHref } from '@/features/media/urls';

// These signature detectors cover ICNS, JPEG XL (container and raw stream),
// HEIC, and AVIF. Upload validation remains authoritative; disabled parsers
// make optional dimensions unavailable without rejecting an allowlisted file.
disableTypes(['heif', 'icns', 'jxl', 'jxl-stream']);

type StorageResult = { error: unknown | null };
type MediaStorage = {
  upload(path: string, body: Uint8Array | Blob, options: { contentType: string; upsert: false }): PromiseLike<StorageResult>;
  remove(paths: string[]): PromiseLike<StorageResult>;
};

export type MediaStorageDatabase = {
  storage: { from(bucket: string): MediaStorage };
  from(table: string): { insert(value: unknown): PromiseLike<StorageResult> };
};

type ImportedMediaDependencies = {
  database?: MediaStorageDatabase;
  createId?: () => string;
};

type UploadedMediaDependencies = {
  bucket: string;
  pathPrefix: string;
  database: MediaStorageDatabase;
  purpose: 'content' | 'avatar' | 'submission' | 'project_cover';
  itemId?: string;
  createId?: () => string;
};

function importedDimensions(mime: string, bytes: Uint8Array) {
  if (!mime.startsWith('image/')) return { width: null, height: null };
  try {
    const dimensions = imageSize(bytes.subarray(0, 64 * 1024));
    return {
      width: typeof dimensions.width === 'number' ? dimensions.width : null,
      height: typeof dimensions.height === 'number' ? dimensions.height : null,
    };
  } catch {
    // Large EXIF/ICC segments can place valid image dimensions beyond the
    // bounded metadata probe. MIME and extension validation remain mandatory.
    return { width: null, height: null };
  }
}

async function uploadedDimensions(file: File) {
  if (!file.type.startsWith('image/')) return { width: null, height: null };
  const buffer = await file.slice(0, 64 * 1024).arrayBuffer();
  return importedDimensions(file.type, new Uint8Array(buffer));
}

/** Stores one validated multipart file and its canonical private asset record. */
export async function uploadMediaFile(file: File, actor: Actor, deps: UploadedMediaDependencies) {
  const { filename } = mediaUploadMetadata(file);
  const { width, height } = await uploadedDimensions(file);
  const id = deps.createId?.() ?? mediaAssetId();
  const prefix = deps.pathPrefix.replace(/^\/+|\/+$/g, '');
  if (!prefix || prefix.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Media storage prefix is invalid');
  }
  const path = `${prefix}/${id}/${filename}`;
  const storage = deps.database.storage.from(deps.bucket);
  const uploadResult = await storage.upload(path, file, { contentType: file.type, upsert: false });
  if (uploadResult.error) throw new Error('Media upload failed');

  try {
    const { error } = await deps.database.from('media_assets').insert({
      id,
      owner_id: actor.userId,
      bucket: deps.bucket,
      path,
      purpose: deps.purpose,
      ...(deps.itemId ? { item_id: deps.itemId } : {}),
      mime: file.type,
      size_bytes: file.size,
      width,
      height,
    });
    if (error) throw new Error('Media record failed');
  } catch {
    try {
      await storage.remove([path]);
    } catch {
      // The failed database insert remains authoritative; cleanup is best effort.
    }
    throw new Error('Media record failed');
  }

  return { id, filename, mime: file.type, sizeBytes: file.size, width, height, path };
}

/** Validates imported media without writing storage or database state. */
export function validateImportedMedia(name: string, bytes: Uint8Array) {
  const mime = mediaMimeForFilename(name);
  if (!mime) throw new ApiError(415, 'UNSUPPORTED_MEDIA', 'Unsupported media file');
  const { filename } = mediaUploadMetadata({ name, type: mime, size: bytes.byteLength });
  return { filename, mime, ...importedDimensions(mime, bytes) };
}

/** Persists one validated bundle asset using the same private media contract as the upload route. */
export async function uploadImportedMedia(
  name: string,
  bytes: Uint8Array,
  actor: Actor,
  deps: ImportedMediaDependencies = {},
) {
  const { filename, mime, width, height } = validateImportedMedia(name, bytes);
  const id = deps.createId?.() ?? mediaAssetId();
  const path = `media/${id}/${filename}`;
  const database = deps.database
    ?? ((await import('@/lib/supabase/server')).supabaseService() as unknown as MediaStorageDatabase);
  const storage = database.storage.from(MEDIA_BUCKET);

  const uploadResult = await storage.upload(path, bytes, { contentType: mime, upsert: false });
  if (uploadResult.error) throw new Error('Media upload failed');

  try {
    const { error } = await database.from('media_assets').insert({
      id,
      owner_id: actor.userId,
      bucket: MEDIA_BUCKET,
      path,
      purpose: 'content',
      mime,
      size_bytes: bytes.byteLength,
      width,
      height,
    });
    if (error) throw new Error('Media record failed');
  } catch {
    try {
      await storage.remove([path]);
    } catch {
      // The failed database insert remains authoritative; cleanup is best effort.
    }
    throw new Error('Media record failed');
  }

  return { id, url: mediaHref(id), mime, sizeBytes: bytes.byteLength, width, height };
}
