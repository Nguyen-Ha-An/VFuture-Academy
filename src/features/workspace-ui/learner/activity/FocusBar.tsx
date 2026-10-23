'use client';

import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { DropdownMenu, DropdownMenuContent, DropdownMenuPortal, DropdownMenuTrigger } from '@/components/ui/classic';
import { LearnerNavigationLink } from '@/features/learner/ui/LearnerNavigationLink';
import type { WorkspaceTheme } from '../../theme';
import { ThemeMenuItems } from '../../ui/ThemeSwitcher';
import { ActivityProgressReadout } from './ActivityProgress';
import { pad2 } from './status';

export type FocusBarProps = {
  course: { title: string; href: string };
  position?: { current: number; total: number };
  /** The course outline trigger and drawer: the only aria-haspopup="dialog" on focus routes. */
  outline?: ReactNode;
  theme?: WorkspaceTheme;
};

/**
 * The 56px activity bar (DESIGN D4, D9): a <nav> with no brand link. It carries the way back to
 * the course, a mono position and progress readout from 760px, the outline and a More options
 * menu that holds theme only. There is no command menu on focus routes.
 */
export function FocusBar({ course, position, outline, theme = 'system' }: FocusBarProps) {
  const t = useTranslations('bench.learner.activity');
  return <nav aria-label={t('bar')} className="vf-focus-bar">
    <LearnerNavigationLink href={course.href} aria-label={t('backTo', { course: course.title })} className="vf-focus-back">
      <span aria-hidden="true" className="vf-l-arrow">←</span>
      <span className="vf-focus-course">{course.title}</span>
    </LearnerNavigationLink>
    <div className="vf-focus-readout">
      {position ? <span className="vf-meta" aria-hidden="true">{pad2(position.current)} / {pad2(position.total)}</span> : null}
      <ActivityProgressReadout />
    </div>
    <div className="vf-focus-actions">
      {outline}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={t('more')} title={t('more')} className="vf-focus-icon"><MoreHorizontal className="size-4" aria-hidden="true" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent align="end" className="w-56">
            <ThemeMenuItems initial={theme} />
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>
    </div>
  </nav>;
}
