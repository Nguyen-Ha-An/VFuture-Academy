import { typedContentPageContext } from '@/features/admin/content-review-production';
import { loadStudioMedia } from '@/features/studio/content-lists-data';
import { MediaLibraryView } from '@/features/studio/ui/content/MediaLibraryView';

export default async function StudioMediaPage() {
  const context = await typedContentPageContext('content.edit', 'media.upload');
  const assets = await loadStudioMedia(context);
  const recoveryScope = context.scope.kind === 'central' ? 'central' : `branch:${context.scope.branchId}`;
  return <MediaLibraryView assets={assets} recoveryKeyPrefix={`studio:${context.actor.userId}:${recoveryScope}`} />;
}
