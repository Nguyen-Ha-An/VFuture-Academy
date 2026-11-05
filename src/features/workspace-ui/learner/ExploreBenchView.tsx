import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PageHeader } from '../ui/PageHeader';

export type ExploreDestination = { href: string; label: string; description: string };

/** /app/explore in the Calibration Bench: exactly the existing destinations as a hairline grid. */
export function ExploreBenchView({ destinations }: { destinations: ExploreDestination[] }) {
  const t = useTranslations('learner.focus');
  const bench = useTranslations('bench.learner.explore');
  return <section aria-labelledby="explore-title" className="canvas-page canvas-learning canvas-explore">
    <PageHeader kicker={bench('kicker')} title={t('exploreTitle')} titleId="explore-title" lead={t('exploreDescription')} />
    <ul className="vf-l-explore">
      {destinations.map((destination) => <li key={destination.href}>
        <Link href={destination.href}>
          <h2>{destination.label}</h2>
          <p>{destination.description}</p>
        </Link>
      </li>)}
    </ul>
  </section>;
}
