import Link from 'next/link';
import { ExamPlayer } from '@/features/exams/ui/ExamPlayer';
import type { ExamClient } from '@/features/exams/ui/client';
import type { LearnerExam } from '@/features/exams/ui/types';
import { normalizeExamSettings } from '@/content-engine/compile/normalize';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import { ActivityFooter } from '@/features/workspace-ui/learner/activity/ActivityFooter';

const unavailable = async (): Promise<never> => { throw new Error('Outside this presentation fixture.'); };
const rich = (text: string) => ({ blocks: [{ type: 'paragraph', content: [{ text }] }] });
const runtime = {
  mode: 'learner', locale: 'en', getBlockState: () => undefined, setBlockState() {}, checkQuestion: unavailable, submitQuiz: unavailable,
  getAssignmentSession: () => undefined, refreshAssignmentSession: unavailable, submitAssignment: unavailable, uploadAssignmentFile: unavailable,
  uploadFile: unavailable, resolveMedia: () => '', hrefFor: () => '/app', markViewed() {}, onActivityComplete() {},
} as unknown as LessonRuntime;
// An active attempt that never writes: autosave and integrity events resolve locally.
const client: ExamClient = {
  session: unavailable, start: unavailable, submit: unavailable, review: unavailable,
  save: async () => [], events: async () => ({ accepted: 0, dropped: 0 }), serverNow: async () => new Date(),
};
const exam = {
  kind: 'exam', id: 'exam', title: 'Module exam', settings: normalizeExamSettings({ layout: 'one_per_page' } as never),
  sections: [{ id: 's1', title: 'Part 1', questions: [
    { id: 'q1', type: 'single_choice', content: rich('Which value resists outliers?'), points: 1, options: [{ id: 'median', content: rich('Median') }, { id: 'mean', content: rich('Mean') }] },
    { id: 'q2', type: 'single_choice', content: rich('Which value is the most frequent?'), points: 1, options: [{ id: 'mode', content: rich('Mode') }, { id: 'range', content: rich('Range') }] },
  ] }],
} as unknown as LearnerExam;
const attempt = {
  attemptId: 'fixture', attemptNo: 1, status: 'in_progress', late: false, startedAt: new Date(), deadlineAt: new Date(Date.now() + 30 * 60_000),
  sectionDeadlines: {}, answers: {}, learner: { sections: [] },
} as never;

// The real item page and outline surround long fixture content; runtime behavior is covered separately.
// Exams mount the real ExamPlayer so the frame aside geometry is measured on the real layout.
export function ItemPlayer({ item }: { item?: { kind?: string } }) {
  if (item?.kind === 'exam') return <ExamPlayer exam={exam} attempt={attempt} client={client} runtime={runtime} onSubmitted={() => {}} headingLevel={2} hideTitle />;
  return <>
    <article aria-label="Fixture lesson">{Array.from({ length: 25 }, (_, index) => <p key={index} className="mb-6">Practice using technology responsibly. This long lesson verifies that the course outline remains available before the content.</p>)}</article>
    <ActivityFooter status={{ tone: 'signal', label: 'Completed' }} action={<Link className="vf-btn vf-btn-primary vf-btn-lg" href="/app/courses/active/items/optional">Next: Optional practice →</Link>} />
  </>;
}
