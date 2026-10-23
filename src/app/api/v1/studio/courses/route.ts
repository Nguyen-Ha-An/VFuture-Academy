import { CourseCreationInputSchema } from '@/features/studio/course-creation';
import { createCourse, listCourses } from '@/features/studio/drafts';
import { withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { typedContentContext } from '@/features/admin/content-review-production';

export const GET = withHandler(async (request) => {
  const { context } = await typedContentContext(request, 'content.read', 'course.read');
  return listCourses(undefined, context.scope);
});

export const POST = withHandler(async (request) => {
  const { context, service: reviews } = await typedContentContext(request, 'content.create', 'course.create', true);
  // Control-shaped, but it is still the first write of a course: read it as strictly
  // as every other content route so no ingress is laxer than the rest.
  const result = await createCourse(CourseCreationInputSchema.parse(await readStrictJsonBodyLimited(request)), context.actor);
  const id = typeof result.course.id === 'string' ? result.course.id : '';
  if (id) await reviews.assignOwnership('course', id);
  return result;
});
