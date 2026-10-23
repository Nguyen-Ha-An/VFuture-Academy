import { getTranslations } from 'next-intl/server';
import { ExploreBenchView } from '@/features/workspace-ui/learner/ExploreBenchView';
import { routes } from '@/lib/routes';

export default async function ExplorePage() {
  const t = await getTranslations('learner.focus');
  const destinations = [
    { href: routes.learner.courses({ tab: 'discover' }), label: t('courses'), description: t('exploreCards.courses') },
    { href: routes.learner.resources(), label: t('resources'), description: t('exploreCards.resources') },
    { href: routes.learner.opportunities(), label: t('opportunities'), description: t('exploreCards.opportunities') },
    { href: routes.learner.projects(), label: t('projects'), description: t('exploreCards.projects') },
  ];
  return <ExploreBenchView destinations={destinations} />;
}
