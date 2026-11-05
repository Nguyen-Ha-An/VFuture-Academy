import { cookies } from 'next/headers';
import { forbidden, notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { CanvasProvider, CanvasLink } from '@/features/canvas/ui';
import { SchoolScopeContinue } from '@/features/admin/components/SchoolScopeNavigation';
import { SchoolNavigationRequestSchema } from '@/features/admin/school-navigation';
import { schoolNavigationFor } from '@/features/admin/school-navigation.server';
import { readWorkspaceTheme } from '@/features/workspace-ui/theme.server';
import { ADMIN_SCOPE_COOKIE, scopeKey } from '@/lib/admin-scope';
import { workspaceHome } from '@/lib/workspaces';

export const dynamic = 'force-dynamic';

/** GET only validates/reads. School selection requires an explicit guarded POST. */
export default async function SchoolScopeEntry({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = SchoolNavigationRequestSchema.safeParse(await searchParams);
  if (!parsed.success) notFound();
  const navigation = await schoolNavigationFor(parsed.data);
  if (!navigation) forbidden();
  const saved = (await cookies()).get(ADMIN_SCOPE_COOKIE)?.value;
  if (saved === scopeKey(navigation.targetScope)) redirect(navigation.destination);
  const [locale, theme] = await Promise.all([getLocale(), readWorkspaceTheme()]);
  const vi = locale === 'vi';
  return <CanvasProvider theme={theme}><main className="canvas-page canvas-admin mx-auto max-w-xl space-y-5 px-4 py-12">
    <h1 className="text-2xl font-semibold">{vi ? `Tiếp tục đến ${navigation.schoolName}` : `Continue to ${navigation.schoolName}`}</h1>
    <p>{vi ? 'Chọn tiếp tục để mở đúng hồ sơ và dữ liệu trong phạm vi trường này.' : 'Continue to open the record and data in this school’s scope.'}</p>
    <SchoolScopeContinue navigation={navigation} label={vi ? `Tiếp tục đến ${navigation.schoolName}` : `Continue to ${navigation.schoolName}`} />
    <CanvasLink href={workspaceHome(navigation.workspace)}>{vi ? 'Quay lại không gian làm việc' : 'Back to workspace'}</CanvasLink>
  </main></CanvasProvider>;
}
