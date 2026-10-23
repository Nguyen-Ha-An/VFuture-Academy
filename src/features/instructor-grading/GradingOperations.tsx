'use client';

import { useEffect, useId, useState } from 'react';
import { useLocale } from 'next-intl';
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
  const id = useId();
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
    <div role="tablist" aria-label={vi ? 'Loại hàng chờ' : 'Queue type'} className="flex min-w-0 gap-1 border-b border-border">
      {tabs.map((value, index) => <button
        key={value}
        type="button"
        id={`${id}-${value}`}
        role="tab"
        aria-selected={tab === value}
        aria-controls={`${id}-panel`}
        tabIndex={tab === value ? 0 : -1}
        onClick={() => select(value)}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 'assignments' : event.key === 'End' ? 'exams' : tabs[1 - index];
            select(next);
            document.getElementById(`${id}-${next}`)?.focus();
          }
        }}
        className={`-mb-px min-h-11 flex-1 whitespace-nowrap border-b-2 px-4 text-sm font-medium leading-normal outline-none transition-colors focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:flex-none ${tab === value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
      >{value === 'assignments' ? (vi ? 'Bài tập' : 'Assignments') : (vi ? 'Kỳ thi' : 'Exams')}</button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} tabIndex={0} className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {tab === 'assignments'
        ? <SubmissionsWorkspace branches={branches} courses={courses} assignments={assignments} titles={titles} canGrade embedded/>
        : <ExamsWorkspace branches={branches} courses={courses} exams={exams} gradingBranchIds={gradingBranchIds} canRelease={false} releaseBranchIds={[]} embedded/>}
    </div>
  </section>;
}
