import { getLocale } from 'next-intl/server';

import { canUseTypedContentPermission, typedContentPageContext } from '@/features/admin/content-review-production';
import { loadStudioCourses } from '@/features/studio/courses-data';
import { CoursesView } from '@/features/studio/ui/CoursesView';

export default async function StudioCoursesPage() {
  const context = await typedContentPageContext('content.read', 'course.read');
  const canCreate = canUseTypedContentPermission(context.actor, context.scope, 'content.create', 'course.create');
  const locale = await getLocale();
  const data = await loadStudioCourses(locale, context.scope);
  return <CoursesView {...data} canCreate={canCreate} />;
}
