import 'server-only';

import { importBundleAsActor } from '@/features/bank/service';
import { uploadImportedMedia, validateImportedMedia } from '@/features/media/storage';
import type { BundleImportHooks } from '@/features/studio/drafts';
import { ApiError } from '@/lib/api';
import { hasPermission, type Actor } from '@/lib/permissions';

/** Connects course bundle imports to the real question-bank and media persistence services. */
export function productionBundleImportHooks(actor: Actor): BundleImportHooks {
  return {
    preflightPersistence: async (requirements, importActor) => {
      if (requirements.hasAssets && !hasPermission(importActor, 'media.upload')) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
      if (requirements.hasQuestions && !hasPermission(importActor, 'bank.edit')) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
    },
    validateMedia: async (filename, bytes) => {
      validateImportedMedia(filename, bytes);
    },
    importQuestions: async (document, importActor) => {
      await importBundleAsActor(document, importActor);
    },
    uploadMedia: async (filename, bytes) => {
      if (!hasPermission(actor, 'media.upload')) {
        throw new ApiError(403, 'FORBIDDEN', 'Permission denied');
      }
      const asset = await uploadImportedMedia(filename, bytes, actor);
      return { assetId: asset.id };
    },
  };
}
