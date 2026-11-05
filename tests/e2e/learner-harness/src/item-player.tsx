import { useState } from 'react';
import Link from 'next/link';
import { AssignmentRenderer, LessonRenderer, registerAll } from '@/content-engine/render';
import type { LearnerItem } from '@/content-engine/compile';
import type { Locale } from '@/content-engine/schema/common';
import type { AssignmentSessionResult } from '@/content-engine/render/assignment-contracts';
import type { LearnerExam } from '@/features/exams/ui/types';
import { ExamFlow } from '@/features/exams/ui/ExamFlow';
import { ActivityFooter } from '@/features/workspace-ui/learner/activity/ActivityFooter';
import { createActivityRuntime, createFixtureExamClient, publishedExam } from './activity-fixtures';
import { fixtureScenario, fixtureTaskRecords } from './scenarios';
registerAll();

/** Real renderer/ExamFlow components. Only their transports and immutable published fixture data are local. */
export function ItemPlayer({ item, courseId, itemId, locale = 'en', assignmentSessions = {}, next }: { item: LearnerItem; courseId?: string; itemId?: string; locale?: Locale; assignmentSessions?: Record<string, AssignmentSessionResult>; next?: { href: string; title: string } }) {
  const [runtime] = useState(() => createActivityRuntime(locale, Object.values(assignmentSessions)[0], new URLSearchParams(location.search)));
  const [exam] = useState(() => item.kind === 'exam' ? item as LearnerExam : publishedExam(locale));
  const [client] = useState(() => {
    const task = fixtureTaskRecords(fixtureScenario()).find(row => row.courseId === courseId && row.itemId === itemId && row.kind === 'exam');
    const phase = task?.status === 'graded' ? 'review' : task?.status === 'submitted' || task?.status === 'pending_manual' ? 'unreleased' : 'active';
    return createFixtureExamClient(exam, new URLSearchParams(location.search).get('examState') ?? phase);
  });
  if (item.kind === 'exam') return <ExamFlow exam={exam} attemptsUsed={0} client={client} runtime={runtime} headingLevel={2} hideTitle />;
  if (item.kind === 'assignment') return <AssignmentRenderer assignment={item} runtime={runtime} hideTitle />;
  return <>
    <LessonRenderer item={item} runtime={runtime} headingLevel={2} presentation hideTitle />
    <ActivityFooter status={{ tone: 'neutral', label: locale === 'en' ? 'Lesson' : 'Bài học' }} action={next ? <Link className="vf-btn vf-btn-primary vf-btn-lg" href={next.href}>{locale === 'en' ? 'Next' : 'Tiếp theo'}: {next.title}</Link> : undefined} />
  </>;
}
