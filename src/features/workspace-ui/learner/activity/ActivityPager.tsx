'use client';

import { LearnerNavigationLink } from '@/features/learner/ui/LearnerNavigationLink';
import { useActivityLocked } from './ActivityProgress';

export type PagerLink = { href: string; title: string; kicker: string };

/**
 * Previous and next items with kind kickers. Previous always comes first, in the DOM, on screen and
 * in the tab order (WCAG 1.3.2 / 2.4.3); below 760px the links stack and Next carries the signal
 * rule. The pager hides while an exam attempt is active so leaving goes through the exam guard.
 */
export function ActivityPager({ label, previous, next }: { label: string; previous?: PagerLink; next?: PagerLink }) {
  const locked = useActivityLocked();
  if (locked || (!previous && !next)) return null;
  return <nav aria-label={label} className="vf-activity-pager">
    {previous ? <LearnerNavigationLink href={previous.href} className="vf-pager-link" data-dir="previous">
      <span className="vf-kicker" data-tone="muted"><span aria-hidden="true">← </span>{previous.kicker}</span>
      <span className="vf-pager-title">{previous.title}</span>
    </LearnerNavigationLink> : <span className="vf-pager-spacer" aria-hidden="true" />}
    {next ? <LearnerNavigationLink href={next.href} className="vf-pager-link" data-dir="next">
      <span className="vf-kicker">{next.kicker}<span aria-hidden="true"> →</span></span>
      <span className="vf-pager-title">{next.title}</span>
    </LearnerNavigationLink> : null}
  </nav>;
}
