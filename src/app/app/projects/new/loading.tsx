import { getTranslations } from 'next-intl/server';
import { PageSkeleton } from '@/features/workspace-ui/ui/BenchState';

// The form route's own skeleton; without it the Projects directory skeleton would show.
export default async function Loading() {
  const t = await getTranslations('learner.focus');
  return <PageSkeleton variant="detail" label={t('loading')} />;
}
