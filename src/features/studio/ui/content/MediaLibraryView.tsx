import { useTranslations } from 'next-intl';

import { MediaLibrary, type MediaAssetWithUsages } from '@/features/studio/ui/MediaLibrary';

export type MediaLibraryViewProps = {
  assets: MediaAssetWithUsages[];
  /** Prefix for per-asset alt-text recovery keys (actor and scope). */
  recoveryKeyPrefix?: string;
};

/** Media page: the file manager renders the H1 with "Choose files" as its one primary action. */
export function MediaLibraryView({ assets, recoveryKeyPrefix }: MediaLibraryViewProps) {
  const t = useTranslations('studio.media');
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <MediaLibrary initialAssets={assets} recoveryKeyPrefix={recoveryKeyPrefix} header={{ eyebrow: t('eyebrow'), title: t('title'), description: t('description') }} />
    </div>
  );
}
