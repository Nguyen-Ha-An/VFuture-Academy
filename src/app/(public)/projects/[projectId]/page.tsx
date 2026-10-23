import type { Metadata } from 'next';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { PublicCoverImage } from '@/features/public-site/PublicCoverImage';
import { notFound } from 'next/navigation';
import type { Locale } from '@/content-engine';
import { publicMediaHref } from '@/features/media/urls';
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
type Props = { params: Promise<{ projectId: string }>; searchParams?: Promise<PublicSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ projectId }, { getLocale }, { getPublicProject }] = await Promise.all([params, import('next-intl/server'), import('@/features/marketing/public-discovery')]);
  const locale = await getLocale() as Locale;
  const item = await getPublicProject(projectId, locale);
  return item ? buildPublicMetadata({ title: item.title, description: item.summary, pathname: routes.public.project(item.id), locale }) : {};
}

export default async function PublicProjectPage({ params, searchParams }: Props) {
  const [{ projectId }, { getLocale, getTranslations }, { getPublicProject }, context] = await Promise.all([params, import('next-intl/server'), import('@/features/marketing/public-discovery'), searchParams ?? Promise.resolve({})]);
  const [locale, t, common] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('build'), getTranslations('publicDiscovery')]);
  const item = await getPublicProject(projectId, locale);
  if (!item) notFound();
  const { getPublicCourse } = await import('@/features/marketing/public-courses');
  const courses = (await Promise.all([...new Set(item.courseIds)].map(id => getPublicCourse(id, locale)))).filter(course => course !== null);
  const copy = discoveryCopy(locale);
  const backHref = publicBackHref('projects', context, locale);
  const destination = routes.learner.project(item.id);
  const breadcrumbs = [{ label: copy.home, href: publicHref('/', locale) }, { label: t('title'), href: backHref }, { label: item.title }];
  const updated = discoveryDate(item.updatedAt, locale);
  const created = discoveryDate(item.createdAt, locale);
  return <PublicDetailLayout className="discovery-project-detail">
    <JsonLd data={breadcrumbJsonLd(breadcrumbs, locale)} />
    <PublicBreadcrumbs items={breadcrumbs} />
    <PublicBackLink href={backHref}>{t('detail.back')}</PublicBackLink>
    <article>
      <header className="discovery-detail-header" data-public-header>
        <p className="public-kicker">{t(`status.${item.status}`)}</p>
        <h1 className="public-title">{item.title}</h1>
        <p className="public-copy">{item.summary}</p>
        <DiscoveryTags values={item.skills} label={t('detail.skills')} />
      </header>
      {item.coverAssetId ? <PublicCoverImage unoptimized src={publicMediaHref(item.coverAssetId)} alt="" width={1440} height={810} sizes="(max-width: 1280px) 100vw, 1280px" className="discovery-detail-cover" /> : null}
      <div className="discovery-detail-body">
        <div>
          <section className="discovery-detail-section" aria-labelledby="project-outputs" data-public-reveal>
            <h2 id="project-outputs" className="discovery-section-heading"><span aria-hidden="true">01</span>{common('projectOutputs')}</h2>
            {item.outputLinks.length ? <ul className="discovery-link-list">{item.outputLinks.map(output => <li key={output.url}><a href={output.url} target="_blank" rel="noopener noreferrer">{output.label || output.url}<ArrowUpRight aria-hidden="true" /></a></li>)}</ul> : <p className="public-copy">{common('projectNoOutputs')}</p>}
          </section>
          {courses.length ? <section className="discovery-detail-section" aria-labelledby="related-courses" data-public-reveal>
            <h2 id="related-courses" className="discovery-section-heading"><span aria-hidden="true">02</span>{t('detail.courses')}</h2>
            <ul className="discovery-link-list">{courses.map(course => <li key={course.id}><PublicLink href={publicHref(routes.public.course(course.id), locale)}>{course.title}<ArrowUpRight aria-hidden="true" /></PublicLink></li>)}</ul>
          </section> : null}
        </div>
        <aside className="discovery-detail-aside" aria-labelledby="project-record">
          <h2 id="project-record">{copy.projectRecord}</h2>
          <dl className="discovery-facts">
            <div><dt>{t('filters.status')}</dt><dd>{t(`status.${item.status}`)}</dd></div>
            {created ? <div><dt>{copy.created}</dt><dd><time dateTime={item.createdAt}>{created}</time></dd></div> : null}
            {updated ? <div><dt>{copy.updated}</dt><dd><time dateTime={item.updatedAt}>{updated}</time></dd></div> : null}
          </dl>
          <PublicLink id="project-primary-action" href={destination} className="public-button" analytics={{ name: 'public.cta_clicked', props: { route: 'project_detail', cta: 'view_project', itemId: item.id } }}>{common('projectAction')}<ArrowRight aria-hidden="true" /></PublicLink>
        </aside>
      </div>
    </article>
    <PublicStickyAction targetId="project-primary-action" href={destination}>{common('projectAction')}</PublicStickyAction>
  </PublicDetailLayout>;
}
