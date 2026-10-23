import type { Metadata } from 'next';
import { ArrowRight, ArrowUpRight, Paperclip } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { MediaRef } from '@/content-engine/schema/common';
import { PATHWAYS } from '@/content-engine/schema/course';
import { StaticRichContent } from '@/features/ecosystem/ui/StaticRichContent';
import { publicMediaHref } from '@/features/media/urls';
import { PublicBackLink, PublicBreadcrumbs, PublicDetailLayout } from '@/features/public-site/PublicPrimitives';
import { PublicLink } from '@/features/public-site/PublicNavigation';
import { PublicStickyAction } from '@/features/public-site/PublicStickyAction';
import { publicBackHref, publicHref, type PublicSearchParams } from '@/features/public-site/public-navigation';
import { breadcrumbJsonLd, buildPublicMetadata, JsonLd } from '@/features/public-site/metadata';
import { publicResourcesCopy } from '@/features/public-site/public-resources-copy';
import { routes } from '@/lib/routes';
import '@/features/public-site/public-resources.css';

export const dynamic = 'force-dynamic';
const mediaHref = (source: MediaRef) => 'url' in source ? source.url : publicMediaHref(source.assetId);
type ResourcePageProps = { params: Promise<{ resourceId: string }>; searchParams?: Promise<PublicSearchParams> };

export async function generateMetadata({ params }: ResourcePageProps): Promise<Metadata> {
  const [{ resourceId }, { getLocale }, { getPublicResource }] = await Promise.all([
    params, import('next-intl/server'), import('@/features/marketing/public-discovery'),
  ]);
  const locale = await getLocale() === 'en' ? 'en' : 'vi';
  const resource = await getPublicResource(resourceId, locale);
  return resource ? buildPublicMetadata({ title: resource.title, description: resource.summary, pathname: routes.public.resource(resource.id), locale }) : {};
}

export default async function PublicResourcePage({ params, searchParams }: ResourcePageProps) {
  const [{ resourceId }, context, { getLocale, getTranslations }, { getPublicResource }] = await Promise.all([
    params, searchParams ?? Promise.resolve({} as PublicSearchParams), import('next-intl/server'), import('@/features/marketing/public-discovery'),
  ]);
  const [requestedLocale, t, common] = await Promise.all([getLocale(), getTranslations('resources'), getTranslations('publicDiscovery')]);
  const locale = requestedLocale === 'en' ? 'en' : 'vi';
  const copy = publicResourcesCopy[locale];
  const resource = await getPublicResource(resourceId, locale);
  if (!resource) notFound();
  const backHref = publicBackHref('resources', context, locale);
  const continueHref = routes.learner.resource(resource.id);
  const breadcrumbs = [{ label: copy.home, href: publicHref('/', locale) }, { label: t('title'), href: backHref }, { label: resource.title }];
  const published = resource.publishedAt ? new Date(resource.publishedAt) : null;
  const hasPublished = published !== null && !Number.isNaN(published.getTime());
  const pathways = resource.pathways.filter((pathway) => PATHWAYS.includes(pathway as (typeof PATHWAYS)[number]));

  return (
    <PublicDetailLayout className="public-resource-detail">
      <JsonLd data={breadcrumbJsonLd([{ label: copy.home, href: '/' }, { label: t('title'), href: routes.public.resources() }, { label: resource.title, href: routes.public.resource(resource.id) }], locale)} />
      <PublicBreadcrumbs items={breadcrumbs} />
      <PublicBackLink href={backHref}>{t('back')}</PublicBackLink>
      <article>
        <header className="public-resource-heading" data-public-header>
          <p className="public-kicker">{t(`types.${resource.resourceType}`)}</p>
          <h1 className="public-title">{resource.title}</h1>
          <p className="public-copy">{resource.summary}</p>
          {resource.tags.length ? <ul className="public-tags" aria-label={t('tag')}>{[...new Set(resource.tags)].map((tag) => <li key={tag}>{tag}</li>)}</ul> : null}
        </header>
        <div className="public-resource-reader">
          <div className="public-resource-reader__main">
            <section id="resource-content" className="public-resource-body" aria-labelledby="resource-content-title">
              <h2 id="resource-content-title" className="public-resource-section-title"><span aria-hidden="true">01</span>{copy.read}</h2>
              <div className="public-prose public-resource-prose">
                <StaticRichContent content={resource.body} publicContent />
                {!resource.body.blocks.length ? <p>{copy.noBody}</p> : null}
              </div>
            </section>
            {resource.attachments.length ? (
              <section id="resource-attachments" className="public-resource-attachments" aria-labelledby="resource-attachments-title">
                <h2 id="resource-attachments-title" className="public-resource-section-title"><span aria-hidden="true">02</span>{t('attachments')}</h2>
                <p className="public-copy">{copy.downloadHelp}</p>
                <ul>
                  {resource.attachments.map((attachment, index) => (
                    <li key={`${attachment.label}:${index}`}><a href={mediaHref(attachment.src)}><Paperclip size={19} aria-hidden="true" /><span>{attachment.label}</span><ArrowUpRight size={18} aria-hidden="true" /></a></li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          <aside className="public-resource-aside" aria-labelledby="resource-about-title">
            <h2 id="resource-about-title" className="public-kicker">{copy.about}</h2>
            <dl>
              <div><dt>{t('type')}</dt><dd>{t(`types.${resource.resourceType}`)}</dd></div>
              {hasPublished ? <div><dt>{copy.published}</dt><dd><time dateTime={published.toISOString()}>{new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(published)}</time></dd></div> : null}
              {pathways.length ? <div><dt>{t('pathway')}</dt><dd>{pathways.map((pathway) => <span key={pathway}>{t(`pathways.${pathway}`)}</span>)}</dd></div> : null}
              {resource.skills.length ? <div><dt>{copy.skills}</dt><dd><ul className="public-tags">{[...new Set(resource.skills)].map((skill) => <li key={skill}>{skill}</li>)}</ul></dd></div> : null}
            </dl>
            <nav aria-label={copy.contents} className="public-resource-contents">
              <a href="#resource-content">{copy.read}<ArrowRight size={15} aria-hidden="true" /></a>
              {resource.attachments.length ? <a href="#resource-attachments">{t('attachments')}<span>{resource.attachments.length}</span></a> : null}
            </nav>
            <div className="public-resource-continue">
              <h3>{copy.continueTitle}</h3>
              <p>{copy.continueHelp}</p>
              <PublicLink id="resource-continue" href={continueHref} className="public-button" analytics={{ name: 'public.cta_clicked', props: { route: 'resource_detail', cta: 'view_resource', itemId: resource.id } }}>{common('resourceAction')}<ArrowRight size={17} aria-hidden="true" /></PublicLink>
            </div>
          </aside>
        </div>
      </article>
      <PublicStickyAction targetId="resource-continue" href={continueHref}>{common('resourceAction')}</PublicStickyAction>
    </PublicDetailLayout>
  );
}
