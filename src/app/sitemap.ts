import type { MetadataRoute } from 'next';
import { listPublicCourses } from '@/features/marketing/public-courses';
import { listPublicOpportunities, listPublicProjects, listPublicResources, type PublicPage } from '@/features/marketing/public-discovery';
import { publicCanonical } from '@/features/public-site/metadata';
import { withoutInternalContent } from '@/lib/internal-content';
import { policyPublication } from '@/features/public-site/policy-publication';
import { routes } from '@/lib/routes';

export const dynamic = 'force-dynamic';

async function everyPublicItem<T>(fetchPage: (page: number) => Promise<PublicPage<T>>): Promise<T[]> {
  const first = await fetchPage(1);
  const pageCount = Math.ceil(first.total / first.pageSize);
  if (pageCount <= 1) return first.items;
  // Bound concurrency for large catalogs while using the public projection on every page.
  const items = [...first.items];
  for (let page = 2; page <= pageCount; page += 10) {
    const pages = await Promise.all(Array.from({ length: Math.min(10, pageCount - page + 1) }, (_, index) => fetchPage(page + index)));
    items.push(...pages.flatMap((result) => result.items));
  }
  return items;
}

type EntryOptions = Pick<MetadataRoute.Sitemap[number], 'changeFrequency' | 'priority' | 'lastModified'>;
function entries(pathname: string, options: EntryOptions): MetadataRoute.Sitemap {
  const languages = { vi: publicCanonical(pathname, 'vi'), en: publicCanonical(pathname, 'en'), 'x-default': publicCanonical(pathname, 'vi') };
  return (['vi', 'en'] as const).map((locale) => ({ url: languages[locale], alternates: { languages }, ...options }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Defense in depth: the public reads already drop hidden fixtures.
  const visible = <T extends { id: string }>(items: T[]) => withoutInternalContent(items, (item) => item.id);
  const [courses, resources, opportunities, projects] = await Promise.all([
    listPublicCourses('vi', { limit: 500 }).then(visible),
    everyPublicItem((page) => listPublicResources('vi', { page, pageSize: 50 })).then(visible),
    everyPublicItem((page) => listPublicOpportunities('vi', { page, pageSize: 50 })).then(visible),
    everyPublicItem((page) => listPublicProjects('vi', { page, pageSize: 50 })).then(visible),
  ]);
  const publication = policyPublication();
  return [
    ...entries('/', { changeFrequency: 'weekly', priority: 1 }),
    ...entries('/courses', { changeFrequency: 'daily', priority: 0.9 }),
    ...entries('/contact', { changeFrequency: 'monthly', priority: 0.5 }),
    ...(publication.approved ? ['/privacy', '/terms'].flatMap((path) => entries(path, { changeFrequency: 'yearly', priority: 0.3, lastModified: publication.effectiveDate! })) : []),
    ...courses.flatMap((course) => entries(`/courses/${encodeURIComponent(course.id)}`, { ...(course.publishedAt ? { lastModified: course.publishedAt } : {}), changeFrequency: 'weekly', priority: 0.8 })),
    ...[routes.public.resources(), routes.public.opportunities(), routes.public.projects()].flatMap((path) => entries(path, { changeFrequency: 'daily', priority: 0.8 })),
    ...resources.flatMap((item) => entries(routes.public.resource(item.id), { ...(item.publishedAt ? { lastModified: item.publishedAt } : {}), changeFrequency: 'weekly', priority: 0.7 })),
    ...opportunities.flatMap((item) => entries(routes.public.opportunity(item.id), { ...(item.publishedAt ? { lastModified: item.publishedAt } : {}), changeFrequency: 'daily', priority: 0.7 })),
    ...projects.flatMap((item) => entries(routes.public.project(item.id), { lastModified: item.updatedAt, changeFrequency: 'weekly', priority: 0.7 })),
  ];
}
