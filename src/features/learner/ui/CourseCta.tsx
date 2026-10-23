'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { EnrollButton, type PrerequisiteLink } from '@/features/learner/ui/EnrollButton';
import { markEnrollHandoff, takeEnrollHandoff } from '@/features/learner/ui/enroll-handoff';

/** Focus the page h1 (made focusable with tabIndex -1), else the status message itself. */
function focusFallback(status: HTMLElement | null) {
  const target = status?.closest('article')?.querySelector('h1') ?? document.querySelector('h1') ?? status;
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
}

/**
 * The course overview's one primary action: Continue/Review for an enrolment, otherwise the enrol
 * button. After a successful enrolment the refreshed page renders the Continue link; focus moves to
 * it and "Enrolled" is announced (role=status). A course with no items has no Continue link, so
 * focus falls back to the page h1 (or the status message) instead of being lost with the button.
 * The handoff survives a remount via sessionStorage.
 */
export function CourseCta({ courseId, enrolled, cta, prerequisites }: {
  courseId: string;
  enrolled: boolean;
  cta: { href: string; label: string } | null;
  prerequisites?: readonly PrerequisiteLink[];
}) {
  const t = useTranslations('learner.course');
  const link = useRef<HTMLAnchorElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const justEnrolled = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const enrolledLabel = t('enrolled');

  useEffect(() => {
    if (!enrolled) return;
    const handedOff = takeEnrollHandoff(courseId);
    if (!justEnrolled.current && !handedOff) return;
    justEnrolled.current = false;
    if (link.current) link.current.focus();
    else focusFallback(status.current);
    setAnnouncement(enrolledLabel);
  }, [enrolled, courseId, enrolledLabel]);

  return <>
    {enrolled
      ? cta ? <Link ref={link} href={cta.href} className="vf-btn vf-btn-primary vf-btn-lg">{cta.label}</Link> : null
      : <EnrollButton courseId={courseId} prerequisites={prerequisites} onEnrolled={() => { justEnrolled.current = true; markEnrollHandoff(courseId); }} />}
    <p ref={status} role="status" className="sr-only">{announcement}</p>
  </>;
}
