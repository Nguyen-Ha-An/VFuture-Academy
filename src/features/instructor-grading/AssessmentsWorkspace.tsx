'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DataCard, DataToolbar, EmptyState } from '@/features/staff-ui/components';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { routes } from '@/lib/routes';
import { ExamsWorkspace } from './ExamsWorkspace';
import type { AssignmentMetadata, BranchOption, CourseOption, ExamOption } from './types';

type AssessmentTab = 'exams' | 'assignments';

type Props = {
  branches: BranchOption[];
  courses: CourseOption[];
  exams: ExamOption[];
  assignments: AssignmentMetadata[];
  canRelease: boolean;
  canGrade: boolean;
  gradingBranchIds: string[] | null;
  releaseBranchIds: string[] | null;
};

export function AssessmentsWorkspace(props: Props) {
  const vi = useLocale() === 'vi';
  const id = useId();
  const tabs: AssessmentTab[] = props.canGrade ? ['exams', 'assignments'] : ['exams'];
  const [tab, setTab] = useState<AssessmentTab>('exams');
  const [course, setCourse] = useState('');

  useEffect(() => {
    const syncFromUrl = () => {
      const query = new URLSearchParams(window.location.search);
      setTab(query.get('tab') === 'assignments' && props.canGrade ? 'assignments' : 'exams');
      setCourse(query.get('courseId') ?? '');
    };
    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [props.canGrade]);

  const commit = (nextTab: AssessmentTab, nextCourse = course) => {
    setTab(nextTab);
    setCourse(nextCourse);
    const query = new URLSearchParams(window.location.search);
    query.set('tab', nextTab);
    if (nextCourse) query.set('courseId', nextCourse);
    else query.delete('courseId');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${query}`);
  };

  const move = (current: number, key: string) => {
    const next = key === 'Home'
      ? 0
      : key === 'End'
        ? tabs.length - 1
        : (current + (key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    commit(tabs[next]);
    document.getElementById(`${id}-${tabs[next]}-tab`)?.focus();
  };

  const filteredAssignments = props.assignments.filter((item) => !course || item.courseId === course);
  const title = vi ? 'Bài tập & bài thi' : 'Assignments & exams';
  const panelId = `${id}-${tab}-panel`;

  return <section className="mx-auto max-w-7xl space-y-6" aria-label={title}>
    <StaffPageHeader
      eyebrow={vi ? 'Đánh giá' : 'Assessments'}
      title={title}
      description={vi ? 'Xem bài đánh giá theo khóa học và phiên bản, mở bài nộp để chấm hoặc công bố kết quả.' : 'Browse assessments by course and version, open submissions for grading, or release results.'}
    />
    <div role="tablist" aria-label={vi ? 'Loại bài đánh giá' : 'Assessment type'} className="flex gap-1 border-b border-border">
      {tabs.map((kind, index) => <button
        key={kind}
        id={`${id}-${kind}-tab`}
        role="tab"
        aria-selected={tab === kind}
        aria-controls={`${id}-${kind}-panel`}
        tabIndex={tab === kind ? 0 : -1}
        onClick={() => commit(kind)}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            move(index, event.key);
          }
        }}
        className={`min-h-11 rounded-t-md border-b-2 px-4 text-sm font-medium leading-normal outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${tab === kind ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'}`}
      >{kind === 'exams' ? (vi ? 'Bài thi' : 'Exams') : (vi ? 'Bài tập' : 'Assignments')}</button>)}
    </div>
    <div id={panelId} role="tabpanel" aria-labelledby={`${id}-${tab}-tab`}>
      {tab === 'exams' ? <ExamsWorkspace {...props} embedded/> : <DataCard
        title={vi ? 'Danh sách bài tập' : 'Assignment list'}
        description={<>
          <p>{vi ? `${filteredAssignments.length} bài tập trong phạm vi đang chọn` : `${filteredAssignments.length} ${filteredAssignments.length === 1 ? 'assignment' : 'assignments'} in the selected scope`}</p>
          <p className="mt-1">{vi ? 'Liên kết bài nộp mở hàng chờ theo khóa học và bài tập, gồm tất cả phiên bản.' : 'Submission links open the course and assignment queue across all versions.'}</p>
        </>}
        toolbar={<DataToolbar
          searchParam={false}
          label={vi ? 'Lọc bài tập' : 'Filter assignments'}
          values={{ courseId: course }}
          onValuesChange={(next) => commit(tab, next.courseId ?? '')}
          filters={[{
            param: 'courseId',
            label: vi ? 'Khóa học' : 'Course',
            allLabel: vi ? 'Tất cả khóa học' : 'All courses',
            options: props.courses.map((item) => ({ value: item.id, label: item.title })),
          }]}
        />}
      >
        {filteredAssignments.length ? <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">{vi ? 'Bài tập' : 'Assignment'}</TableHead>
              <TableHead scope="col" className="hidden sm:table-cell">{vi ? 'Khóa học' : 'Course'}</TableHead>
              <TableHead scope="col" className="hidden md:table-cell">Rubric</TableHead>
              <TableHead scope="col" className="w-32"><span className="sr-only">{vi ? 'Thao tác' : 'Action'}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAssignments.map((item) => {
              const criteriaCount = item.rubric.criteria.length;
              const maxPoints = item.rubric.criteria.reduce((total, criterion) => total + criterion.maxPoints, 0);
              const versionLabel = typeof item.version === 'number' && Number.isSafeInteger(item.version) && item.version > 0
                ? `${vi ? 'Phiên bản' : 'Version'} ${item.version}`
                : (vi ? 'Không rõ phiên bản' : 'Version unavailable');
              const rubricSummary = vi
                ? `${criteriaCount} tiêu chí · ${maxPoints} điểm`
                : `${criteriaCount} ${criteriaCount === 1 ? 'criterion' : 'criteria'} · ${maxPoints} ${maxPoints === 1 ? 'point' : 'points'}`;
              return <TableRow key={`${item.courseVersionId}:${item.assignmentId}`}>
                <th scope="row" className="min-w-0 py-3 pr-2 text-left align-top font-normal">
                  <p className="break-words font-medium leading-normal text-foreground">{item.itemTitle}</p>
                  <p className="mt-1 text-xs leading-normal text-muted-foreground tabular-nums">{versionLabel}</p>
                  <p className="mt-1 break-words text-xs leading-normal text-muted-foreground sm:hidden">{item.courseTitle}</p>
                  <p className="mt-1 text-xs leading-normal text-muted-foreground md:hidden">{rubricSummary}</p>
                </th>
                <TableCell className="hidden max-w-64 whitespace-normal py-3 align-top leading-normal sm:table-cell">{item.courseTitle}</TableCell>
                <TableCell className="hidden whitespace-nowrap py-3 align-top tabular-nums md:table-cell">{rubricSummary}</TableCell>
                <TableCell className="py-3 align-top">
                  <Button asChild size="sm" variant="outline" className="h-auto min-h-11 max-w-36 flex-col gap-0.5 whitespace-normal px-2 py-2 text-center leading-normal sm:max-w-none sm:px-3">
                    <Link aria-label={vi ? 'Xem bài nộp · mọi phiên bản' : 'View submissions · all versions'} href={routes.grading.queue({ tab: 'assignments', courseId: item.courseId, assignmentId: item.assignmentId, ...(props.branches.length === 1 ? { branchId: props.branches[0].id } : {}), back: routes.grading.assessments() })}><span>{vi ? 'Xem bài nộp' : 'View submissions'}</span><span className="text-xs font-normal leading-normal">{vi ? 'Mọi phiên bản' : 'All versions'}</span></Link>
                  </Button>
                </TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table> : <div className="p-6"><EmptyState
          title={vi ? 'Chưa có bài tập trong phạm vi này' : 'No assignments in this scope'}
          description={props.assignments.length ? (vi ? 'Chọn một khóa học khác để xem bài tập.' : 'Choose another course to see its assignments.') : undefined}
        /></div>}
      </DataCard>}
    </div>
    {tabs.filter((kind) => kind !== tab).map((kind) => <div
      key={kind}
      id={`${id}-${kind}-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-${kind}-tab`}
      hidden
    />)}
  </section>;
}
