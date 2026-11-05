import { useEffect, useMemo, useState } from 'react';
import { AssessmentsWorkspace } from '../../../../src/features/instructor-grading/AssessmentsWorkspace';
import { TeachingForbidden } from '../../../../src/features/instructor-grading/TeachingForbidden';
import type { AssignmentMetadata, BranchOption, CourseOption, ExamOption } from '../../../../src/features/instructor-grading/types';

/** Local-only fixture for the real assessment list and exam release workflow. */
export function AssessmentsFixture({ locale }: { locale: 'vi' | 'en' }) {
  const [ready, setReady] = useState(false);
  const data = useMemo(() => {
    const vi = locale === 'vi';
    const branches: BranchOption[] = [{ id: 'school', name: vi ? 'Trường VFuture' : 'VFuture school' }, { id: 'other', name: vi ? 'Trường khác' : 'Other school' }];
    const courses: CourseOption[] = [{ id: 'physics', title: vi ? 'Vật lý và phân tích dữ liệu' : 'Physics and data analysis' }];
    const exams: ExamOption[] = [{ courseId: 'physics', courseTitle: courses[0].title, courseVersionId: 'version-1', version: 2, itemId: 'exam-1', itemTitle: vi ? 'Bài thi học kỳ' : 'End of term exam' }];
    const assignments: AssignmentMetadata[] = [{ courseId: 'physics', courseTitle: courses[0].title, courseVersionId: 'version-1', version: 2, itemId: 'homework', itemTitle: vi ? 'Phân tích dữ liệu thực nghiệm' : 'Experimental data analysis', assignmentId: 'homework', rubric: { criteria: [{ id: 'evidence', name: vi ? 'Bằng chứng' : 'Evidence', maxPoints: 5 }] } }];
    return { branches, courses, exams, assignments };
  }, [locale]);
  useEffect(() => {
    const original = window.fetch;
    const scenario = new URLSearchParams(location.search).get('fixture');
    let releasedAt: string | null = null;
    window.fetch = async (input, init) => {
      const url = String(input);
      if (!url.includes('/api/v1/studio/exams/')) return original(input, init);
      if (scenario === 'error') return new Response(JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Fixture failure' } }), { status: 503, headers: { 'content-type': 'application/json' } });
      const body = (value: unknown) => new Response(JSON.stringify({ data: value }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/release') && init?.method === 'POST') {
        releasedAt = '2026-11-05T04:00:00.000Z';
        return body({ released: [{ attemptId: 'attempt-legacy', releasedAt }], skipped: { forbidden: 0, unassigned: 0, alreadyReleased: [], notReleasable: [] } });
      }
      return body({ attempts: [{ attemptId: 'attempt-legacy', userId: 'learner', learnerName: 'Nguyễn Thị Thanh Hương', courseVersionId: 'version-1', itemId: 'exam-1', branchId: 'school', attemptNo: 1, status: 'graded', late: false, startedAt: '2026-11-05T00:00:00.000Z', deadlineAt: null, submittedAt: '2026-11-05T00:20:00.000Z', points: 8, maxPoints: 10, percent: 80, releasedAt, resultAvailableAt: null, integrityEventCount: 0, pendingManualQuestions: [] }], skipped: { unassigned: 0 } });
    };
    setReady(true);
    return () => { window.fetch = original; };
  }, []);
  if (!ready) return null;
  const scenario = new URLSearchParams(location.search).get('fixture');
  if (scenario === 'forbidden') return <TeachingForbidden />;
  return <AssessmentsWorkspace {...data} canGrade canRelease gradingBranchIds={['school']} releaseBranchIds={['school']} />;
}
