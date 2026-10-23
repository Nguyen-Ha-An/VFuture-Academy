import { getLocale } from 'next-intl/server';

import { gradingOverview } from '@/features/grading/overview';
import { GradingHomeView } from '@/features/grading/ui/GradingHomeView';
import { instructorBranchScope } from '@/features/instructor-grading/server-data';
import { gradingPageContext } from '@/features/workspace/context';
import { can } from '@/lib/permissions';
import { workspaceNavigationFor } from '@/lib/workspace-navigation';

export const dynamic = 'force-dynamic';

export default async function GradingPage() {
  const [context, locale] = await Promise.all([gradingPageContext(), getLocale()]);
  const destinations = workspaceNavigationFor('grading', context.permissions)
    .filter(item => item.key !== 'home')
    .map(({ key, href }) => ({ key, href }));
  // The same scope rule as /grading/queue; report-only operators get the shortcuts alone.
  const scope = !can(context.actor, 'submission.grade', context.scope)
    ? null
    : context.scope.kind === 'branch'
      ? { global: false, branchIds: [context.scope.branchId] }
      : instructorBranchScope(context.actor, 'submission.grade');
  const overview = scope && (scope.global || scope.branchIds.length > 0)
    ? await gradingOverview({ actor: context.actor, scope, locale: locale === 'en' ? 'en' : 'vi' })
    : undefined;
  return <GradingHomeView destinations={destinations} overview={overview} />;
}
