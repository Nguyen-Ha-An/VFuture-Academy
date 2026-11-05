import 'server-only';

import { cookies } from 'next/headers';
import { adminPageContext } from '@/features/admin/context';
import { gradingPageContext, studioPageContext } from '@/features/workspace/context';
import { ADMIN_SCOPE_COOKIE } from '@/lib/admin-scope';
import { buildSchoolNavigation, schoolTargetWorkspace, type SchoolNavigationRequest } from './school-navigation';

/** Resolve the destination workspace independently of the source page's active school. */
export async function schoolNavigationFor(target: SchoolNavigationRequest) {
  const workspace = schoolTargetWorkspace(target);
  const context = workspace === 'admin' ? await adminPageContext()
    : workspace === 'grading' ? await gradingPageContext() : await studioPageContext();
  const savedScopeKey = (await cookies()).get(ADMIN_SCOPE_COOKIE)?.value ?? null;
  return buildSchoolNavigation(context, target, savedScopeKey);
}
