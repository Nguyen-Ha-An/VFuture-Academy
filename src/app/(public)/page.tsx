import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { EntranceShell } from '@/features/workspace-ui/auth/EntranceShell';
import { redirect } from 'next/navigation';
import { getActor } from '@/lib/permissions';
import { safeInternalPath } from '@/lib/safe-internal-path';
import { workspaceEntries } from '@/lib/workspace-admission';
import { getSessionUser } from '@/lib/auth';

export const metadata = { title: 'VFuture Academy', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function AcademyHomePage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const user = await getSessionUser();
  const actor = user ? await getActor() : null;
  if (actor) {
    const { next } = await searchParams;
    const entries = workspaceEntries(actor);
    redirect(typeof next === 'string' ? safeInternalPath(next) : entries.studio ?? entries.grading ?? entries.admin ?? '/app');
  }
  return <EntranceShell><main><Suspense fallback={null}><AuthForm mode="login" /></Suspense></main></EntranceShell>;
}
