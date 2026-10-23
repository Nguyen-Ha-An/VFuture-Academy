import { importNewCourse, NewCourseImportInputSchema } from '@/features/studio/drafts';
import { ApiError, toValidationIssues, withHandler } from '@/lib/api';
import { readStrictJsonBodyLimited } from '@/lib/body-limit';
import { typedContentContext } from '@/features/admin/content-review-production';

export const POST = withHandler(async (request) => {
  const { context, service: reviews } = await typedContentContext(request, 'content.create', 'course.create', true);
  const actor = context.actor;
  const parsed = NewCourseImportInputSchema.safeParse(await readStrictJsonBodyLimited(request, { envelope: true }));
  if (!parsed.success) throw new ApiError(422, 'INVALID_COURSE', 'Course import request is invalid', toValidationIssues(parsed.error.issues));
  const { text } = parsed.data;
  const result = await importNewCourse(text, actor);
  await reviews.assignOwnership('course', result.draft.courseId);
  return result;
});
