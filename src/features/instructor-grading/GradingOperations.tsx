'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { CanvasTabs } from '@/features/canvas/ui';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { ExamsWorkspace } from './ExamsWorkspace';
import { SubmissionsWorkspace, type QueueTitles } from './SubmissionsWorkspace';
import type { AssignmentMetadata, BranchOption, CourseOption, ExamOption } from './types';

type QueueTab = 'assignments' | 'exams';

function tabFromUrl(): QueueTab {
  const query = new URLSearchParams(window.location.search);
  return query.get('tab') === 'exams' || query.get('kind') === 'exam' ? 'exams' : 'assignments';
}

export function GradingOperations({ branches, courses, assignments, exams, gradingBranchIds, titles }: { branches: BranchOption[]; courses: CourseOption[]; assignments: AssignmentMetadata[]; exams: ExamOption[]; gradingBranchIds: string[] | null; /** Localized course/item titles by course version, for rows without assignment metadata. */ titles?: QueueTitles }) {
  const [tab, setTab] = useState<QueueTab>('assignments');
  const vi = useLocale() === 'vi';
  const tabs: QueueTab[] = ['assignments', 'exams'];

  useEffect(() => {
    const syncFromUrl = () => setTab(tabFromUrl());
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, []);

  function select(next: QueueTab) {
    setTab(next);
    const query = new URLSearchParams(window.location.search);
    query.set('tab', next);
    query.delete('kind');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${query}`);
  }

  return <section className="mx-auto max-w-7xl min-w-0 space-y-6" aria-label={vi ? 'Hàng chờ chấm bài' : 'Grading queues'}>
    <StaffPageHeader
      eyebrow={vi ? 'Chấm bài' : 'Grading'}
      title={vi ? 'Hàng chờ chấm bài' : 'Grading queues'}
      description={vi ? 'Xem bài nộp đang chờ, mở bài làm và hoàn tất điểm cho học viên.' : 'Review queued submissions, open learner work, and complete grading.'}
    />
    <CanvasTabs screenReaderLabel={vi ? 'Loại hàng chờ' : 'Queue type'} onRequestTabChange={(_event, data) => select(tabs[data.index])}>
      <CanvasTabs.Panel renderTitle={vi ? 'Bài tập' : 'Assignments'} isSelected={tab === 'assignments'} padding="none">
        <div className="pt-5"><SubmissionsWorkspace branches={branches} courses={courses} assignments={assignments} titles={titles} canGrade embedded /></div>
      </CanvasTabs.Panel>
      <CanvasTabs.Panel renderTitle={vi ? 'Kỳ thi' : 'Exams'} isSelected={tab === 'exams'} padding="none">
        <div className="pt-5"><ExamsWorkspace branches={branches} courses={courses} exams={exams} gradingBranchIds={gradingBranchIds} canRelease={false} releaseBranchIds={[]} embedded /></div>
      </CanvasTabs.Panel>
    </CanvasTabs>
  </section>;
}
