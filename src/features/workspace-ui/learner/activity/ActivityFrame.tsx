import type { ReactNode } from 'react';

import type { WorkspaceTheme } from '../../theme';
import { ActivityProgressProvider, ActivityStatusTag, type ActivityProgressValue } from './ActivityProgress';
import { ActivityPager, type PagerLink } from './ActivityPager';
import { FocusBar } from './FocusBar';

export type ActivityKind = 'lesson' | 'assignment' | 'exam' | 'notebook';
/** reading 760px, column 1080px, frame 1384px (column + gap + aside). */
export type ActivityWidth = 'reading' | 'column' | 'frame';

export const defaultActivityWidth = (kind: ActivityKind): ActivityWidth => (kind === 'lesson' ? 'reading' : kind === 'assignment' ? 'column' : 'frame');

export type ActivityFrameProps = {
  kind: ActivityKind;
  width?: ActivityWidth;
  course: { title: string; href: string };
  progress: ActivityProgressValue;
  position?: { current: number; total: number };
  outline?: ReactNode;
  theme?: WorkspaceTheme;
  head: { kicker: ReactNode; title: string; meta?: ReactNode[]; status?: string };
  aside?: ReactNode;
  pager?: { label: string; previous?: PagerLink; next?: PagerLink };
  children: ReactNode;
};

/**
 * The focused shell for lessons, assignments, exams and notebooks (DESIGN D9): the focus bar,
 * one head with a full-width h1, one body at the activity width, and the previous/next pager.
 * Head, body and pager share one left edge; the player owns the single footer.
 */
export function ActivityFrame({ kind, width = defaultActivityWidth(kind), course, progress, position, outline, theme, head, aside, pager, children }: ActivityFrameProps) {
  const meta = (head.meta ?? []).filter(Boolean);
  return <ActivityProgressProvider initial={progress} status={head.status}>
    <article className="vf-activity" data-learning-kind={kind} data-width={width}>
      <FocusBar course={course} position={position} outline={outline} theme={theme} />
      <div className="vf-activity-body">
        <header className="vf-activity-head">
          <p className="vf-kicker m-0">{head.kicker}</p>
          <h1 className="vf-activity-title">{head.title}</h1>
          {meta.length || head.status ? <div className="vf-activity-meta">
            {meta.length ? <p className="vf-meta vf-l-head-meta m-0">{meta.map((item, index) => <span key={index}>{item}</span>)}</p> : null}
            {head.status ? <ActivityStatusTag initial={head.status} /> : null}
          </div> : null}
        </header>
        {aside
          ? <div className="vf-l-split" data-aside><div data-area="main" className="vf-activity-main">{children}</div><aside data-area="aside">{aside}</aside></div>
          : <div className="vf-activity-main">{children}</div>}
        {pager ? <ActivityPager label={pager.label} previous={pager.previous} next={pager.next} /> : null}
      </div>
    </article>
  </ActivityProgressProvider>;
}

export type { PagerLink } from './ActivityPager';
