import { useTranslations } from 'next-intl';

import { StatCard, StatGrid } from '@/features/staff-ui/components';
import type { CoursesData } from '@/features/studio/courses-data';
import { StaffPageHeader } from '@/features/workspace/ui/StaffPageHeader';
import { CourseImportButton } from './CourseImportButton';
import { CoursesTable } from './CoursesTable';
import { NewCourseDialog } from './NewCourseDialog';

export type CoursesViewProps = CoursesData & {
  /** Shows "New course" (the primary action) and the import button. */
  canCreate?: boolean;
};

/**
 * /studio/courses: H1 with the one primary action, snapshot KPIs by lifecycle stage (no deltas),
 * then the course data card. Props are plain data, so the e2e harness can render it with fixtures.
 */
export function CoursesView({ rows, reviews, canCreate = false }: CoursesViewProps) {
  const legacy = useTranslations('studio.courses');
  const t = useTranslations('staffUi.studio.courses.kpi');
  const count = (stage: CoursesData['rows'][number]['stage']) => rows.filter((row) => row.stage === stage).length;
  // Stage counts depend on review requests; without them a draft in review would count as a draft.
  const stageState = reviews === 'ready' ? 'ready' : 'unavailable';
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <StaffPageHeader
        eyebrow={legacy('eyebrow')}
        title={legacy('title')}
        description={legacy('description')}
        actions={canCreate ? <div className="flex flex-wrap gap-2"><CourseImportButton /><NewCourseDialog /></div> : undefined}
      />
      {rows.length > 0 ? (
        <StatGrid aria-label={t('label')}>
          <StatCard label={t('total')} value={rows.length} />
          <StatCard label={t('drafts')} value={count('draft')} state={stageState} unavailableLabel={t('unavailable')} />
          <StatCard label={t('inReview')} value={count('in_review')} state={stageState} unavailableLabel={t('unavailable')} />
          <StatCard label={t('published')} value={count('published')} state={stageState} unavailableLabel={t('unavailable')} />
        </StatGrid>
      ) : null}
      <CoursesTable rows={rows} reviews={reviews} />
    </div>
  );
}
