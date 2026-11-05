import { teachingPageData } from '@/features/instructor-grading/teaching-page-data';
import { AnnouncementsWorkspace } from '@/features/instructor-grading/AnnouncementsWorkspace';

export default async function AnnouncementsPage() {
  const { branches, locale } = await teachingPageData('teaching.announcement.manage');
  return <AnnouncementsWorkspace branches={branches} locale={locale} />;
}
