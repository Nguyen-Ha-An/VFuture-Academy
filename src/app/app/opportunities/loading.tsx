import { getTranslations } from 'next-intl/server';
import { PageSkeleton } from '@/features/workspace-ui/ui/BenchState';

export default async function Loading() {
  const t = await getTranslations('learner.focus');
  return <PageSkeleton variant="directory" label={t('loading')} />;
}
