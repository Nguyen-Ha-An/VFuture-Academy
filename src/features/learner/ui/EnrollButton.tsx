'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { routes } from '@/lib/routes';

type ApiEnvelope = { error?: { code?: string; issues?: Array<{ path?: unknown }> } };

/** A prerequisite course the learner can open from a PREREQ_MISSING error ("Needs …"). */
export type PrerequisiteLink = { id: string; label: string };

function missingPrerequisites(body: ApiEnvelope, known: readonly PrerequisiteLink[]): PrerequisiteLink[] {
  const ids = (body.error?.issues ?? []).flatMap((issue) => (
    Array.isArray(issue.path) && issue.path[0] === 'prerequisites' && typeof issue.path[1] === 'string' ? [issue.path[1]] : []
  ));
  const labels = new Map(known.map((course) => [course.id, course.label]));
  return [...new Set(ids.length ? ids : known.map((course) => course.id))].map((id) => ({ id, label: labels.get(id) ?? id }));
}

export function EnrollButton({ courseId, prerequisites = [], onEnrolled }: {
  courseId: string;
  /** Labels (authored code or title) for the course's prerequisites. */
  prerequisites?: readonly PrerequisiteLink[];
  /** Runs after a successful enrolment, before the page refreshes. */
  onEnrolled?: () => void;
}) {
  const t = useTranslations('learner.course');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needs, setNeeds] = useState<PrerequisiteLink[]>([]);

  const enroll = async () => {
    setPending(true);
    setError(null);
    setNeeds([]);
    let enrolled = false;
    try {
      const response = await fetch(`/api/v1/courses/${encodeURIComponent(courseId)}/enroll`, { method: 'POST' });
      const body = await response.json() as ApiEnvelope;
      if (!response.ok) {
        const code = body.error?.code;
        if (code === 'PREREQ_MISSING') setNeeds(missingPrerequisites(body, prerequisites));
        setError(code === 'INVITE_ONLY' ? t('inviteOnly') : code === 'PREREQ_MISSING' ? t('prerequisiteMissing') : t('enrollError'));
        return;
      }
      enrolled = true;
      onEnrolled?.();
      router.refresh();
    } catch {
      setError(t('enrollError'));
    } finally {
      // After a success the button stays busy until the refreshed page replaces it.
      if (!enrolled) setPending(false);
    }
  };

  return (
    <div>
      <button type="button" onClick={() => void enroll()} disabled={pending} aria-busy={pending || undefined} className="vf-btn vf-btn-primary vf-btn-lg vf-btn-block">
        {pending ? t('enrolling') : t('enroll')}
      </button>
      {error ? <div role="alert"><p>{error}</p></div> : null}
      {needs.length ? <p className="vf-l-needs"><span>{t('needs')}</span>{needs.map((course) => <Link key={course.id} href={routes.learner.course(course.id)}>{course.label}</Link>)}</p> : null}
    </div>
  );
}
