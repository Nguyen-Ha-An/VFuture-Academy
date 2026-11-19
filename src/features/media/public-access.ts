import 'server-only';

import { ResourceDocumentSchema } from '@/content-engine/schema/bundle';
import { LOCALES, type MediaRef } from '@/content-engine/schema/common';
import type { ContentBlock } from '@/content-engine/schema/types';
import { publicOpportunityDescription } from '@/features/opportunities/schema';
import { ApiError } from '@/lib/api';
import { INTERNAL_ID_PREFIX, internalContentPolicy } from '@/lib/internal-content';
import type { supabaseService } from '@/lib/supabase/server';

type PublicMediaDatabase = Pick<ReturnType<typeof supabaseService>, 'rpc'>;
const PAGE_SIZE = 8;

function isAsset(ref: MediaRef | undefined, id: string) {
  return ref !== undefined && 'assetId' in ref && ref.assetId === id;
}

function renderedBlocksUseAsset(blocks: ContentBlock[], id: string): boolean {
  return blocks.some((block) => {
    switch (block.type) {
      case 'image':
      case 'audio':
      case 'pdf':
        return isAsset(block.src, id);
      case 'video':
        return !block.provider && (isAsset(block.src, id) || isAsset(block.poster, id));
      case 'callout':
        return renderedBlocksUseAsset(block.blocks, id);
      default:
        return false;
    }
  });
}

function sourceUsesAsset(kind: string, parentId: string, source: unknown, id: string) {
  if (kind === 'course' || kind === 'project') return source === null;
  if (kind === 'opportunity') {
    return LOCALES.some((locale) => {
      const description = publicOpportunityDescription(source, locale);
      return description !== null && renderedBlocksUseAsset(description.blocks, id);
    });
  }
  if (kind !== 'resource') return false;
  const result = ResourceDocumentSchema.safeParse(source);
  if (!result.success || result.data.id !== parentId) return false;
  if (result.data.attachments?.some((item) => isAsset(item.src, id))) return true;
  const { body } = result.data;
  if ('blocks' in body) return renderedBlocksUseAsset(body.blocks, id);
  return LOCALES.some((locale) => body[locale] && renderedBlocksUseAsset(body[locale].blocks, id));
}

type Candidate = {
  bucket: string; path: string; size_bytes: unknown; source_kind: string; parent_id: string; source: unknown;
};

function unavailable(): never {
  throw new ApiError(503, 'PUBLIC_MEDIA_UNAVAILABLE', 'Public media is temporarily unavailable');
}

export async function getPublicProjectionAsset(database: PublicMediaDatabase, assetId: string) {
  const policy = internalContentPolicy();
  const hiddenIds = policy.hidden ? [...policy.ids] : [];
  let afterKind = '';
  let afterId = '';
  for (;;) {
    const { data, error } = await database.rpc('academy_public_media_asset', {
      p_asset_id: assetId,
      p_hidden_prefix: policy.hidden ? INTERNAL_ID_PREFIX : null, p_hidden_ids: hiddenIds,
      p_after_kind: afterKind, p_after_id: afterId, p_page_size: PAGE_SIZE,
    });
    if (error || !Array.isArray(data) || data.length > PAGE_SIZE) unavailable();
    const candidates: Candidate[] = data;
    for (const candidate of candidates) {
      if (candidate?.bucket === 'media' && typeof candidate.path === 'string' &&
          sourceUsesAsset(candidate.source_kind, candidate.parent_id, candidate.source, assetId)) {
        return { bucket: candidate.bucket, path: candidate.path, sizeBytes: candidate.size_bytes };
      }
    }
    if (candidates.length < PAGE_SIZE) return null;
    const last = candidates[candidates.length - 1];
    if (!last || typeof last.source_kind !== 'string' || typeof last.parent_id !== 'string' ||
        (last.source_kind === afterKind && last.parent_id === afterId)) unavailable();
    afterKind = last.source_kind;
    afterId = last.parent_id;
  }
}
