import { ArrowUpRight, Clock3 } from 'lucide-react';
import { PublicCoverImage } from './PublicCoverImage';
import { useTranslations } from 'next-intl';
import { levelMessageKey, pathwayMessageKey } from '@/features/marketing/catalog-labels';
import type { PublicCourse } from '@/features/marketing/public-courses';
import { publicMediaHref } from '@/features/media/urls';
import { PublicLink } from './PublicNavigation';
import './public-learning.css';

export function PublicCourseCard({ course, href, position }: { course: PublicCourse; href: string; position: number }) {
  const t = useTranslations('marketing');
  const coverUrl = course.cover ? 'url' in course.cover ? course.cover.url : publicMediaHref(course.cover.assetId) : undefined;
  return (
    <article className="public-card public-course-card" data-public-reveal>
      <div className="public-card__media public-course-card__media">
        <PublicCoverImage src={coverUrl} unoptimized={Boolean(course.cover && 'assetId' in course.cover)} alt="" width={960} height={540} sizes="(min-width: 1440px) 640px, (min-width: 768px) 46vw, 92vw" className="public-course-card__image" />
        <span className="public-course-card__index" aria-hidden="true">{String(position).padStart(2, '0')}</span>
      </div>
      <div className="public-card__body public-course-card__body">
        <div className="public-meta public-course-card__metadata"><span>{t(levelMessageKey(course.level))}</span>{course.estimatedMinutes ? <span><Clock3 size={14} aria-hidden="true" />{t('featured.minutes', { minutes: course.estimatedMinutes })}</span> : null}</div>
        <p className="public-kicker public-course-card__pathway">{t(pathwayMessageKey(course.pathway))}</p>
        <h2><PublicLink href={href} analytics={{ name: 'landing.course_card_clicked', props: { courseId: course.id } }} aria-label={t('featured.open', { course: course.title })}>{course.title}<ArrowUpRight size={22} aria-hidden="true" /></PublicLink></h2>
        <p className="public-copy public-course-card__summary">{course.summary}</p>
        {course.skills.length ? <ul className="public-tags public-course-card__skills" aria-label={t('featured.skills')}>{course.skills.slice(0, 3).map(skill => <li key={skill.id}>{skill.name}</li>)}</ul> : null}
      </div>
    </article>
  );
}
