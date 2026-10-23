import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BenchState } from '@/features/workspace-ui/ui/BenchState';
import { routes } from '@/lib/routes';

export default async function NotFound() {
  const t = await getTranslations('learner.focus');
  return <BenchState
    kind="not-found"
    kicker="404"
    title={t('noContent')}
    titleAs="h1"
    titleId="learner-not-found-title"
    body={t('noContentDescription')}
    actions={<Link href={routes.learner.dashboard()} className="vf-btn vf-btn-primary vf-btn-lg">{t('backHome')}</Link>}
  />;
}
