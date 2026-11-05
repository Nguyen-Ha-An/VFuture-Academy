import { useEffect, useState } from 'react';
import { GradingWorkbench, type WorkbenchTitles } from '../../../../src/features/instructor-grading/GradingWorkbench';

/**
 * A submission from the queue fixture (staff-pages-fixture.tsx): the workbench then loads that
 * submission and shows its resolved titles and the server-computed "Next in queue" link.
 */
export type QueueWorkbenchFixture = {
  submission: { id: string; learnerName: string; submittedAt: string; payload: { text?: string }; status: string; attemptNo: number };
  titles: WorkbenchTitles;
  nextHref: string | null;
};

const assignment = {
  kind: 'assignment',
  submission: { id: 'fixture-submission', userId: 'learner', learnerName: 'Fixture learner', branchId: 'fixture-branch', courseVersionId: 'fixture-version', itemId: 'fixture-lesson', blockId: 'fixture-assignment', assignmentId: 'fixture-assignment', attemptNo: 1, status: 'submitted', submittedAt: '2026-09-07T00:00:00.000Z', dueAtSnapshot: '2026-09-06T17:00:00.000Z', late: true, payload: { text: 'Fixture response' }, files: [] },
  source: { courseId: 'fixture-course', courseVersionId: 'fixture-version', courseVersion: 1, publishedAt: '2026-09-01T00:00:00.000Z', itemId: 'fixture-lesson', assignmentId: 'fixture-assignment', locale: 'en', availableLocales: ['en'], prompt: { id: 'fixture-assignment', type: 'assignment', title: 'Fixture assignment', instructions: { blocks: [{ type: 'paragraph', content: [{ text: 'Pinned assignment instructions' }] }] }, submission: { accepts: ['text'] } }, rubric: { criteria: [{ id: 'quality', name: 'Quality', maxPoints: 4 }] }, settings: { submission: { accepts: ['text'] }, resubmission: 'until_approved' } },
};

// The manual question already carries a saved draft score, so its result must be the scored
// result that saving produces — a stored `manualPoints` beside `pending_manual` is a state the
// server never emits, and it made the screenshots read "Awaiting grading" next to a score.
const autoQuestion = { questionId: 'fixture-auto', sectionId: 'fixture', order: 0, type: 'single_choice', prompt: { id: 'fixture-auto', type: 'single_choice', content: { blocks: [] }, options: [] }, grading: { points: 1 }, answer: 'a', result: { status: 'correct', points: 1, maxPoints: 1 }, manualPoints: null, manualFeedback: null, gradedBy: null, updatedAt: null };
const manualQuestion = { questionId: 'fixture-manual', sectionId: 'fixture', order: 1, type: 'essay', prompt: { id: 'fixture-manual', type: 'essay', content: { blocks: [] } }, grading: { points: 4 }, answer: 'Fixture essay', result: { status: 'partial', points: 2, maxPoints: 4 }, manualPoints: 2, manualFeedback: 'Pinned feedback', gradedBy: 'grader', updatedAt: null };
const pendingAttempt = { attemptId: 'fixture-attempt', userId: 'learner', courseVersionId: 'fixture-version', itemId: 'fixture-exam', branchId: 'fixture-branch', attemptNo: 1, status: 'pending_manual', late: false, startedAt: '2026-09-07T00:00:00.000Z', deadlineAt: null, submittedAt: '2026-09-07T00:10:00.000Z', points: null, maxPoints: null, percent: null, releasedAt: null, resultAvailableAt: null, integrityEventCount: 0 };
const completedAttempt = { ...pendingAttempt, status: 'graded', points: 3, maxPoints: 5, percent: 60, resultAvailableAt: '2026-09-07T04:10:00.000Z' };
const examSource = { locale: 'en', defaultLocale: 'en', sections: [], learner: {}, gradingSnapshot: { questions: {} } };

type ManualDraft = { points: number; feedback: string };

function examDetail(completed: boolean, draft: ManualDraft, busy = false, drafts: Record<string, ManualDraft> = {}) {
  const manual = {
    ...manualQuestion,
    manualPoints: draft.points,
    manualFeedback: draft.feedback,
    result: { status: draft.points >= 4 ? 'correct' : 'partial', points: draft.points, maxPoints: 4 },
  };
  const busyQuestions = Array.from({ length: 7 }, (_, index) => {
    const type = index === 1 ? 'code_answer' : index === 2 ? 'upload_answer' : 'essay';
    const questionId = `busy-${index + 1}`;
    const saved = drafts[questionId] ?? { points: 2, feedback: 'Saved draft feedback' };
    const answer = type === 'code_answer' ? { code: 'def evaluate(data):\n    return sum(data) / len(data)' } : type === 'upload_answer' ? { files: [{ assetId: 'fixture-asset', name: 'research-submission.pdf', size: 204800, mime: 'application/pdf' }] } : 'Long learner response. Phân tích bằng chứng và giải thích phương pháp. '.repeat(8);
    return { ...manualQuestion, questionId, order: index + 1, type, prompt: { id: questionId, type, content: { blocks: [{ type: 'paragraph', content: [{ text: 'Explain your reasoning and supporting evidence. Giải thích lập luận và bằng chứng.' }] }] }, ...(type === 'upload_answer' ? { accepts: ['file', 'link', 'text'], maxFiles: 3, allowedMimeTypes: ['application/pdf'] } : type === 'code_answer' ? { language: 'python' } : {}) }, answer, manualPoints: saved.points, manualFeedback: saved.feedback, result: { status: 'partial', points: saved.points, maxPoints: 4 } };
  });
  return {
    kind: 'exam',
    learnerName: busy ? 'Nguyễn Thị Thanh Hương — Long bilingual learner name' : 'Fixture learner',
    attempt: completed ? { ...completedAttempt, points: busy ? 1 + busyQuestions.reduce((sum, question) => sum + question.manualPoints, 0) : 1 + draft.points, maxPoints: busy ? 29 : 5, percent: busy ? Math.round(((1 + busyQuestions.reduce((sum, question) => sum + question.manualPoints, 0)) / 29) * 10000) / 100 : Math.round(((1 + draft.points) / 5) * 10000) / 100 } : pendingAttempt,
    source: examSource,
    questions: busy ? [autoQuestion, ...busyQuestions] : [autoQuestion, manual],
    manualGrading: busy ? { total: 7, scored: 7, outstanding: [], complete: true } : { total: 1, scored: 1, outstanding: [], complete: true },
  };
}

/**
 * Browser-harness-only fixture: it supplies local fetch responses and does not ship with
 * production routes. `?completion=malformed` makes the completion endpoint answer 200 with an
 * incomplete DTO, so the harness can prove the workbench refuses to lock on it.
 */
export function GradingFixture({ kind, queued, locale = 'en' }: { kind: 'assignments' | 'exams'; queued?: QueueWorkbenchFixture | null; locale?: 'vi' | 'en' }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = window.fetch;
    const malformed = new URLSearchParams(location.search).get('completion') === 'malformed';
    const busy = new URLSearchParams(location.search).get('fixture') === 'busy';
    const currentAssignment = busy ? {
      ...assignment,
      submission: { ...assignment.submission, learnerName: 'Nguyễn Thị Thanh Hương — Long bilingual learner name', payload: { text: 'A detailed response with bilingual context. Phân tích bằng chứng và giải thích phương pháp. '.repeat(8), code: { language: 'python', code: 'def evaluate(data):\n    return sum(data) / len(data)' }, links: [{ url: 'https://example.org/research', label: 'Research evidence' }] }, files: [{ assetId: 'fixture-asset', name: 'bilingual-research-submission.pdf', size: 204800, mime: 'application/pdf' }] },
      source: { ...assignment.source, prompt: { ...assignment.source.prompt, title: { en: 'Research project and evidence analysis', vi: 'Dự án nghiên cứu và phân tích bằng chứng' } }, rubric: { criteria: [
        { id: 'quality', name: { en: 'Research quality', vi: 'Chất lượng nghiên cứu' }, maxPoints: 4 },
        { id: 'evidence', name: { en: 'Use of evidence', vi: 'Sử dụng bằng chứng' }, maxPoints: 6 },
        { id: 'communication', name: { en: 'Communication and reflection', vi: 'Truyền đạt và phản tư' }, maxPoints: 5 },
      ] } },
    } : assignment;

    let completed = false;
    // A saved manual grade must persist, exactly as the real endpoint does: the detail refetch
    // that follows the save has to return the points and feedback the grader just sent.
    let draft: ManualDraft = { points: manualQuestion.manualPoints, feedback: manualQuestion.manualFeedback };
    const drafts: Record<string, ManualDraft> = {};
    window.fetch = async (input, init) => {
      const url = String(input);
      const body = (payload: unknown) => new Response(JSON.stringify({ data: payload }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/complete-grading')) {
        if (malformed) return body({ attempt: { ...completedAttempt, resultAvailableAt: null }, transitioned: true });
        completed = true;
        return body({ attempt: examDetail(true, draft, busy, drafts).attempt, transitioned: true });
      }
      if (url.includes('/manual-grade')) {
        const request = JSON.parse(String(init?.body)) as { questionId: string; points: number; feedback: string };
        draft = { points: request.points, feedback: request.feedback };
        drafts[request.questionId] = draft;
        return body(pendingAttempt);
      }
      if (url.includes('/submissions/') && init?.method === 'POST') {
        const request = JSON.parse(String(init.body)) as { rubricScores: Record<string, number>; feedback: string; decision: string; release: boolean };
        return body({ submission: { ...currentAssignment.submission, status: request.release ? 'approved' : 'in_review', grade: { rubricScores: request.rubricScores, feedback: request.feedback, decision: request.decision, released: request.release, totalPoints: Object.values(request.rubricScores).reduce((sum, points) => sum + points, 0), maxPoints: busy ? 15 : 4, gradedAt: '2026-09-07T05:00:00.000Z' } } });
      }
      if (url.includes('/exams/')) return body(examDetail(completed, draft, busy, drafts));
      if (queued) return body({ ...assignment, submission: { ...assignment.submission, ...queued.submission } });
      return body(currentAssignment);
    };
    setReady(true);
    return () => { window.fetch = original; };
  }, [queued]);
  if (!ready) return null;
  if (queued && kind === 'assignments') return <GradingWorkbench kind="assignments" id={queued.submission.id} actorId="fixture-grader" scope="branch:fixture-branch" locale={locale} canRelease titles={queued.titles} nextHref={queued.nextHref} />;
  return <GradingWorkbench kind={kind} id={kind === 'exams' ? 'fixture-attempt' : 'fixture-submission'} actorId="fixture-grader" scope="branch:fixture-branch" locale={locale} canRelease />;
}
