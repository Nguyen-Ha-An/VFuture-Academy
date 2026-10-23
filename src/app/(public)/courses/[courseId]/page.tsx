import type { Metadata } from 'next';
import { ArrowRight, ArrowUpRight, Check, Clock3 } from 'lucide-react';
import { PublicCoverImage } from '@/features/public-site/PublicCoverImage';
import { notFound } from 'next/navigation';
import type { Locale } from '@/content-engine';
import { difficultyMessageKey, levelMessageKey, pathwayMessageKey } from '@/features/marketing/catalog-labels';
import { publicMediaHref } from '@/features/media/urls';
import { PublicBackLink, PublicBreadcrumbs, PublicDetailLayout, PublicPageHeader } from '@/features/public-site/PublicPrimitives';
import { PublicLink } from '@/features/public-site/PublicNavigation';
import { PublicStickyAction } from '@/features/public-site/PublicStickyAction';
import { publicBackHref, publicHref, type PublicSearchParams } from '@/features/public-site/public-navigation';
import { buildPublicMetadata, breadcrumbJsonLd, JsonLd } from '@/features/public-site/metadata';
import { learningCopy } from '@/features/public-site/public-learning-copy';
import { routes } from '@/lib/routes';
import '@/features/public-site/public-learning.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ courseId: string }> }): Promise<Metadata> {
  const [{ courseId }, { getLocale }, { getPublicCourse }] = await Promise.all([params, import('next-intl/server'), import('@/features/marketing/public-courses')]);
  const locale = await getLocale() as Locale;
  const course = await getPublicCourse(courseId, locale);
  if (!course) return {};
  return buildPublicMetadata({ title: course.title, description: course.summary, pathname: routes.public.course(course.id), locale });
}

export default async function PublicCoursePage({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams?: Promise<PublicSearchParams> }) {
  const [{ courseId }, { getLocale, getTranslations }, { getPublicCourse, listPublicOpportunitiesByIds }, context] = await Promise.all([params, import('next-intl/server'), import('@/features/marketing/public-courses'), searchParams ?? Promise.resolve({} as PublicSearchParams)]);
  const [locale, t] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('marketing')]);
  const course = await getPublicCourse(courseId, locale);
  if (!course) notFound();
  const relatedOpportunities = await listPublicOpportunitiesByIds(locale, course.relatedOpportunityIds ?? []);
  const copy = learningCopy[locale];
  const backHref = publicBackHref('courses', context, locale);
  const learnerHref = routes.learner.course(course.id);
  const breadcrumbs = [{ label: copy.home, href: publicHref('/', locale) }, { label: copy.courses, href: backHref }, { label: course.title }];
  const coverUrl = course.cover ? 'url' in course.cover ? course.cover.url : publicMediaHref(course.cover.assetId) : undefined;
  const activityCount = course.modules.reduce((count, module) => count + module.items.length, 0);
  return (
    <PublicDetailLayout className="public-course-detail">
      <JsonLd data={breadcrumbJsonLd(breadcrumbs, locale)} />
      <article>
        <div className="public-course-content">
          <PublicBreadcrumbs items={breadcrumbs} />
          <PublicBackLink href={backHref}>{t('course.back')}</PublicBackLink>
          <div className="public-course-hero">
            <PublicPageHeader eyebrow={t('course.eyebrow')} title={course.title} description={course.summary} />
            <aside className="public-course-overview" aria-label={copy.overview} data-public-reveal>
              <p className="public-kicker">{t(pathwayMessageKey(course.pathway))}</p>
              <ul className="public-tags"><li>{t(levelMessageKey(course.level))}</li><li>{t(difficultyMessageKey(course.difficulty))}</li></ul>
              <dl className="public-course-facts">
                {course.estimatedMinutes ? <div><dt><Clock3 size={15} aria-hidden="true" />{t('course.duration')}</dt><dd>{t('course.minutes', { minutes: course.estimatedMinutes })}</dd></div> : null}
                <div><dt>{t('course.outline')}</dt><dd>{copy.moduleCount(course.modules.length)}<span>{copy.activityCount(activityCount)}</span></dd></div>
              </dl>
              <PublicLink id="course-primary-action" href={learnerHref} className="public-button" analytics={{ name: 'public.cta_clicked', props: { route: 'course_detail', cta: 'enroll', itemId: course.id } }}>{t('course.continueToCourse')}<ArrowRight size={17} aria-hidden="true" /></PublicLink>
              <p className="public-course-account-note">{copy.accountNote}</p>
            </aside>
          </div>
          {coverUrl ? <div className="public-course-cover" data-public-reveal><PublicCoverImage src={coverUrl} unoptimized={Boolean(course.cover && 'assetId' in course.cover)} alt="" width={1440} height={660} sizes="(min-width: 1440px) 1280px, 92vw" /></div> : null}
          <div className="public-course-body public-section">
            <section aria-labelledby="outcomes-heading" data-public-reveal>
              <p className="public-kicker">01 / {t('course.outcomes')}</p>
              <h2 id="outcomes-heading">{t('course.outcomes')}</h2>
              {course.learningOutcomes.length ? <ul className="public-course-outcomes">{course.learningOutcomes.map((outcome, index) => <li key={`${index}:${outcome}`}><Check size={17} aria-hidden="true" /><span>{outcome}</span></li>)}</ul> : <p className="public-copy">{copy.noOutcomes}</p>}
              {course.skills.length ? <div className="public-course-skills"><h3>{t('course.skills')}</h3><ul className="public-tags">{course.skills.map(skill => <li key={skill.id}>{skill.name}</li>)}</ul></div> : null}
            </section>
            <section aria-labelledby="outline-heading" data-public-reveal>
              <p className="public-kicker">02 / {t('course.outline')}</p>
              <h2 id="outline-heading">{t('course.outline')}</h2>
              <p className="public-copy public-course-outline-note">{copy.outlineNote}</p>
              {course.modules.length ? <ol className="public-course-outline">{course.modules.map((module, index) => <li key={module.id}>
                <div className="public-course-module"><span className="public-meta">{String(index + 1).padStart(2, '0')}</span><h3>{module.title}</h3></div>
                <ul>{module.items.map(item => <li key={item.id}><span>{item.title}</span><span className="public-course-item-meta">{t(`course.itemKinds.${item.type}`)}{item.required ? <span> · {t('course.required')}</span> : null}{item.estimatedMinutes ? <span> · {t('course.minutes', { minutes: item.estimatedMinutes })}</span> : null}</span></li>)}</ul>
              </li>)}</ol> : <p className="public-copy">{copy.noOutline}</p>}
            </section>
          </div>
          {relatedOpportunities.length ? <section className="public-section public-course-related" aria-labelledby="related-opportunities-heading" data-public-reveal><p className="public-kicker">03 / {copy.nextEyebrow}</p><h2 id="related-opportunities-heading">{t('course.relatedOpportunities')}</h2><ul>{relatedOpportunities.map(opportunity => <li key={opportunity.id}><article>{opportunity.organization ? <p className="public-meta">{opportunity.organization}</p> : null}<h3><PublicLink href={publicHref(routes.public.opportunity(opportunity.id), locale)}>{opportunity.title}<ArrowUpRight size={21} aria-hidden="true" /></PublicLink></h3>{opportunity.summary ? <p className="public-copy">{opportunity.summary}</p> : null}</article></li>)}</ul></section> : null}
        </div>
      </article>
      <PublicStickyAction targetId="course-primary-action" href={learnerHref}>{t('course.continueToCourse')}</PublicStickyAction>
    </PublicDetailLayout>
  );
}
