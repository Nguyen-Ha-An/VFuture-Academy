import { forbidden } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { gradingPageContext } from '@/features/workspace/context';
import { can } from '@/lib/permissions';
import { instructorBranchScope, loadInstructorPageData } from './server-data';

export async function teachingPageData(permission: 'teaching.announcement.manage' | 'teaching.schedule.manage') {
  const [context, locale] = await Promise.all([gradingPageContext(), getLocale()]);
  if (!can(context.actor, permission, context.scope)) forbidden();
  const scope = context.scope.kind === 'branch'
    ? { global: false, branchIds: [context.scope.branchId] }
    : instructorBranchScope(context.actor, permission);
  if (!scope.global && !scope.branchIds.length) forbidden();
  const { branches, metadata } = await loadInstructorPageData(locale, scope);
  return { branches, metadata, locale: locale === 'vi' ? 'vi' as const : 'en' as const };
}
