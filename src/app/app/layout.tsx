import { redirect } from 'next/navigation';

import { AppShell } from '@/components/AppShell';
import { learnerIdentity } from '@/features/workspace-ui/identity.server';
import { readWorkspaceTheme } from '@/features/workspace-ui/theme.server';
import { loginDestination } from '@/lib/auth';
import { getActor } from '@/lib/permissions';
import { workspaceEntries } from '@/lib/workspace-admission';

export default async function LearnerLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect(await loginDestination());

  // Every staff workspace is offered from the actor's full authorization, so a
  // grader-only or report-only operator still reaches their own workspace.
  const entries = workspaceEntries(actor);
  const [theme, identity] = await Promise.all([readWorkspaceTheme(), learnerIdentity()]);
  return <AppShell studioDestination={entries.studio} gradingDestination={entries.grading} adminDestination={entries.admin} userName={identity.name} initials={identity.initials} handle={identity.handle} theme={theme}>{children}</AppShell>;
}
