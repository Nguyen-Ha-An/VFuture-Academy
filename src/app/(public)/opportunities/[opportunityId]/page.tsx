import type { Metadata } from 'next';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { Locale } from '@/content-engine';
import { StaticRichContent } from '@/features/ecosystem/ui/StaticRichContent';
import { opportunityAvailability } from '@/features/opportunities/availability';
import { PublicBackLink, PublicBreadcrumbs, PublicDetailLayout } from '@/features/public-site/PublicPrimitives';
import { PublicLink } from '@/features/public-site/PublicNavigation';
import { PublicStickyAction } from '@/features/public-site/PublicStickyAction';
import { publicBackHref, publicHref, type PublicSearchParams } from '@/features/public-site/public-navigation';
import { DiscoveryTags } from '@/features/public-site/public-discovery-cards';
import { discoveryCopy, discoveryDate } from '@/features/public-site/public-discovery-copy';
import { buildPublicMetadata, breadcrumbJsonLd, JsonLd } from '@/features/public-site/metadata';
import { routes } from '@/lib/routes';
import '@/features/public-site/public-discovery.css';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ opportunityId: string }>; searchParams?: Promise<PublicSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ opportunityId }, { getLocale }, { getPublicOpportunity }] = await Promise.all([params, import('next-intl/server'), import('@/features/marketing/public-discovery')]);
  const locale = await getLocale() as Locale;
  const item = await getPublicOpportunity(opportunityId, locale);
  return item ? buildPublicMetadata({ title: item.title, description: `${item.organization} · ${item.title}`, pathname: routes.public.opportunity(item.id), locale }) : {};
}

export default async function PublicOpportunityPage({ params, searchParams }: Props) {
  const [{ opportunityId }, { getLocale, getTranslations }, { getPublicOpportunity }, context] = await Promise.all([params, import('next-intl/server'), import('@/features/marketing/public-discovery'), searchParams ?? Promise.resolve({})]);
  const [locale, t, common] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('opportunities'), getTranslations('publicDiscovery')]);
  const item = await getPublicOpportunity(opportunityId, locale);
  if (!item) notFound();
  const { getPublicCourse } = await import('@/features/marketing/public-courses');
  const courseIds = [...new Set([...item.recommendedCourses, ...item.requiredCourses])];
  const publicCourses = (await Promise.all(courseIds.map(id => getPublicCourse(id, locale)))).filter(course => course !== null);
  const recommendedCourses = publicCourses.filter(course => item.recommendedCourses.includes(course.id));
  const requiredCourses = publicCourses.filter(course => item.requiredCourses.includes(course.id));
  const copy = discoveryCopy(locale);
  const availability = opportunityAvailability(item.openAt, item.closeAt);
  const canApply = availability === 'open' && Boolean(item.internalParticipation || item.applicationUrl);
  const protectedDestination = routes.auth.login({ next: routes.learner.opportunity(item.id) });
  const actionLabel = item.internalParticipation ? common('opportunityAction') : t('action.apply');
  const backHref = publicBackHref('opportunities', context, locale);
  const breadcrumbs = [{ label: copy.home, href: publicHref('/', locale) }, { label: t('title'), href: backHref }, { label: item.title }];
  const dates = (['openAt', 'closeAt', 'startAt', 'endAt'] as const).flatMap(key => {
    const date = discoveryDate(item[key], locale, true);
    return date ? [{ key, value: item[key]!, label: date }] : [];
  });
  return <PublicDetailLayout className="discovery-opportunity-detail">
    <JsonLd data={breadcrumbJsonLd(breadcrumbs, locale)} />
    <PublicBreadcrumbs items={breadcrumbs} />
    <PublicBackLink href={backHref}>{t('back')}</PublicBackLink>
    <article>
      <header className="discovery-detail-header" data-public-header>
        <p className="public-kicker">{t(`types.${item.type}`)}</p>
        <h1 className="public-title">{item.title}</h1>
        <p className="public-copy">{item.organization}</p>
        <div className="public-actions"><span className={`discovery-availability discovery-availability--${availability}`}>{t(`availability.${availability}`)}</span>{item.featured ? <span className="discovery-featured">{t('featured')}</span> : null}</div>
      </header>
      <div className="discovery-detail-body">
        <div>
          <section className="discovery-detail-section" aria-labelledby="opportunity-overview" data-public-reveal>
            <h2 id="opportunity-overview" className="discovery-section-heading"><span aria-hidden="true">01</span>{copy.overviewOpportunity}</h2>
            <div className="public-prose"><StaticRichContent content={item.description} publicContent /></div>
          </section>
          {item.recommendedSkills.length ? <section className="discovery-detail-section" aria-labelledby="opportunity-skills" data-public-reveal>
            <h2 id="opportunity-skills" className="discovery-section-heading"><span aria-hidden="true">02</span>{t('recommendedSkills')}</h2>
            <DiscoveryTags values={item.recommendedSkills} label={t('recommendedSkills')} />
          </section> : null}
          {requiredCourses.length || recommendedCourses.length ? <section className="discovery-detail-section" aria-labelledby="opportunity-learning" data-public-reveal>
            <h2 id="opportunity-learning" className="discovery-section-heading"><span aria-hidden="true">{item.recommendedSkills.length ? '03' : '02'}</span>{copy.learning}</h2>
            {requiredCourses.length ? <><h3>{t('requiredCourses')}</h3><ul className="discovery-link-list">{requiredCourses.map(course => <li key={course.id}><PublicLink href={publicHref(routes.public.course(course.id), locale)}>{course.title}<ArrowUpRight aria-hidden="true" /></PublicLink></li>)}</ul></> : null}
            {recommendedCourses.length ? <><h3>{t('recommendedCourses')}</h3><ul className="discovery-link-list">{recommendedCourses.map(course => <li key={course.id}><PublicLink href={publicHref(routes.public.course(course.id), locale)}>{course.title}<ArrowUpRight aria-hidden="true" /></PublicLink></li>)}</ul></> : null}
            <p className="discovery-note">{copy.eligibilityNote}</p>
          </section> : null}
        </div>
        <aside className="discovery-detail-aside" aria-labelledby="application-details">
          <h2 id="application-details">{copy.application}</h2>
          <dl className="discovery-facts">
            <div><dt>{copy.organization}</dt><dd>{item.organization}</dd></div>
            {item.location || item.online ? <div><dt>{t('location')}</dt><dd>{[item.location, item.online ? t('online') : null].filter(Boolean).join(' · ')}</dd></div> : null}
            {dates.map(date => <div key={date.key}><dt>{t(`dateLabels.${date.key}`)}</dt><dd><time dateTime={date.value}>{date.label}</time></dd></div>)}
          </dl>
          {canApply ? <><PublicLink id="opportunity-primary-action" href={protectedDestination} className="public-button" analytics={{ name: 'public.cta_clicked', props: { route: 'opportunity_detail', cta: 'apply', itemId: item.id } }}>{actionLabel}<ArrowRight aria-hidden="true" /></PublicLink><p className="discovery-note">{copy.continueNote}</p></> : <p className="discovery-note">{availability !== 'open' ? t(`action.${availability}`) : copy.noApplication}</p>}
        </aside>
      </div>
    </article>
    {canApply ? <PublicStickyAction targetId="opportunity-primary-action" href={protectedDestination}>{actionLabel}</PublicStickyAction> : null}
  </PublicDetailLayout>;
}
