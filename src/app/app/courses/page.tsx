import { getLocale } from 'next-intl/server';

import type { Locale } from '@/content-engine';
import { listCatalog } from '@/features/catalog/service';
import { parseCatalogContext, type CatalogSearchParams } from '@/features/learner/catalog-filters';
import { CatalogBenchView } from '@/features/workspace-ui/learner/CatalogBenchView';
import { unmetPrerequisiteLabels } from '@/features/workspace-ui/format';
import { requireUser } from '@/lib/auth';

export default async function LearnerCatalogPage({ searchParams }: { searchParams: Promise<CatalogSearchParams> }) {
  const [user, localeValue, params] = await Promise.all([requireUser(), getLocale(), searchParams]);
  const locale: Locale = localeValue === 'en' ? 'en' : 'vi';
  const { tab, ...filters } = parseCatalogContext(params);
  const courses = await listCatalog({ userId: user.id, roles: [] }, locale, filters);
  // Prerequisite status needs the whole catalog, not just the filtered page of it.
  const needsCatalog = courses.some((course) => course.prerequisites?.length);
  const everything = needsCatalog && Object.values(filters).some(Boolean) ? await listCatalog({ userId: user.id, roles: [] }, locale, {}) : courses;
  return <CatalogBenchView courses={courses.map((course) => ({ ...course, unmetPrerequisites: unmetPrerequisiteLabels(course, everything) }))} tab={tab} filters={filters} />;
}
