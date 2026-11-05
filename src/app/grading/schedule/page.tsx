import { teachingPageData } from '@/features/instructor-grading/teaching-page-data';
import { ScheduleWorkspace } from '@/features/instructor-grading/ScheduleWorkspace';

export default async function SchedulePage() {
  const { branches, locale } = await teachingPageData('teaching.schedule.manage');
  return <ScheduleWorkspace branches={branches} locale={locale} />;
}
