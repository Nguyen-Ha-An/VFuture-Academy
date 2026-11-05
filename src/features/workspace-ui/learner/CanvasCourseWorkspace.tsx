import Link from 'next/link';
import './learner-routes.css';
import { CanvasCourseLayout, CanvasLink } from '@/features/canvas/ui';
import type { ReactNode } from 'react';
import { routes } from '@/lib/routes';
import { canvasCopy } from './canvas-copy';

export const COURSE_TABS = ['overview', 'modules', 'assignments', 'grades', 'announcements', 'calendar'] as const;
export type CourseTab = typeof COURSE_TABS[number];
export function courseTab(value: unknown): CourseTab { return COURSE_TABS.includes(value as CourseTab) ? value as CourseTab : 'overview'; }
export function CanvasCourseWorkspace({ id, title, code, locale, tab, listContext = {}, header, action, overview, modules, assignments, grades, announcements, calendar }: { id: string; title: string; code?: string; locale: string; tab: CourseTab; listContext?: Record<string, string | undefined>; header?: ReactNode; action?: ReactNode; overview: ReactNode; modules: ReactNode; assignments: ReactNode; grades: ReactNode; announcements: ReactNode; calendar: ReactNode }) {
  const copy = canvasCopy(locale);
  const panels = { overview, modules, assignments, grades, announcements, calendar };
  return <article className="canvas-page canvas-learning canvas-course-workspace">
    <header className="canvas-course-heading"><div>{header ?? <Link href={routes.learner.courses({ tab: 'learning' })} className="canvas-course-breadcrumb">{copy.courses}</Link>}{code && <p className="canvas-course-eyebrow">{code}</p>}<h1>{title}</h1></div>{action}</header>
    <CanvasCourseLayout navigation={<nav className="canvas-course-links" aria-label={title}>{COURSE_TABS.map(key => <CanvasLink key={key} href={routes.learner.course(id, { ...listContext, view: key })} aria-current={tab === key ? 'page' : undefined}>{copy[key]}</CanvasLink>)}</nav>}>
    <section className="canvas-course-tab-panel" aria-labelledby={`course-${tab}-heading`}><h2 id={`course-${tab}-heading`} className="canvas-tab-title">{copy[tab]}</h2>{panels[tab]}</section></CanvasCourseLayout>
  </article>;
}
