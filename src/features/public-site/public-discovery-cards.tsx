import { PublicCoverImage } from '@/features/public-site/PublicCoverImage';
import { ArrowUpRight } from 'lucide-react';
import type { Locale } from '@/content-engine';
import type { PublicOpportunity, PublicProject } from '@/features/marketing/public-discovery';
import { publicMediaHref } from '@/features/media/urls';
import { opportunityAvailability } from '@/features/opportunities/availability';
import { PublicLink } from './PublicNavigation';
import { discoveryCopy, discoveryDate } from './public-discovery-copy';

type Translate = (key: string) => string;

export function DiscoveryTags({ values, label }: { values: string[]; label: string }) {
  if (!values.length) return null;
  return <ul className="public-tags discovery-tags" aria-label={label}>{values.map(value => <li key={value}>{value}</li>)}</ul>;
}

export function ProjectGalleryCard({ item, href, locale, t, position }: { item: PublicProject; href: string; locale: Locale; t: Translate; position: number }) {
  const copy = discoveryCopy(locale);
  const updated = discoveryDate(item.updatedAt, locale);
  return <article className="discovery-project-card" data-public-reveal>
    <div className={`public-card__media discovery-project-card__media${item.coverAssetId ? '' : ' discovery-project-card__media--empty'}`}>
      {item.coverAssetId ? <PublicCoverImage unoptimized src={publicMediaHref(item.coverAssetId)} alt="" width={960} height={600} sizes="(max-width: 700px) 100vw, 50vw" className="discovery-project-image" /> : <div className="discovery-project-placeholder" aria-hidden="true"><span>VF / {String(position + 1).padStart(2, '0')}</span><span>{copy.noCover}</span></div>}
    </div>
    <div className="discovery-project-card__body">
      <div className="discovery-card-meta"><span className="public-kicker">{t(`status.${item.status}`)}</span>{updated ? <span>{copy.updated} <time dateTime={item.updatedAt}>{updated}</time></span> : null}</div>
      <h2><PublicLink href={href} className="discovery-title-link" analytics={{ name: 'public.card_clicked', props: { route: 'projects', catalog: 'projects', itemId: item.id } }}>{item.title}<ArrowUpRight aria-hidden="true" /></PublicLink></h2>
      <p className="public-copy">{item.summary}</p>
      <DiscoveryTags values={item.skills.slice(0, 4)} label={t('card.skills')} />
    </div>
  </article>;
}

export function OpportunityRow({ item, href, locale, t }: { item: PublicOpportunity; href: string; locale: Locale; t: Translate }) {
  const availability = opportunityAvailability(item.openAt, item.closeAt);
  const dateKey = availability === 'upcoming' ? 'openAt' : item.closeAt ? 'closeAt' : item.startAt ? 'startAt' : null;
  const date = dateKey ? discoveryDate(item[dateKey], locale, true) : null;
  return <article className="discovery-opportunity-row" data-public-reveal>
    <div className="discovery-opportunity-row__type"><span className="public-kicker">{t(`types.${item.type}`)}</span>{item.featured ? <span className="discovery-featured">{t('featured')}</span> : null}</div>
    <div className="discovery-opportunity-row__body"><p className="discovery-organization">{item.organization}</p><h2><PublicLink href={href} className="discovery-title-link" analytics={{ name: 'public.card_clicked', props: { route: 'opportunities', catalog: 'opportunities', itemId: item.id } }}>{item.title}<ArrowUpRight aria-hidden="true" /></PublicLink></h2>{item.location || item.online ? <p className="public-meta">{[item.location, item.online ? t('online') : null].filter(Boolean).join(' · ')}</p> : null}</div>
    <div className="discovery-opportunity-row__status"><span className={`discovery-availability discovery-availability--${availability}`}>{t(`availability.${availability}`)}</span>{date && dateKey ? <p><span>{t(`dateLabels.${dateKey}`)}</span><time dateTime={item[dateKey] ?? undefined}>{date}</time></p> : null}</div>
  </article>;
}
