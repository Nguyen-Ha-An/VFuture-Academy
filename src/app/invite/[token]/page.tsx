import { notFound, redirect } from 'next/navigation';

import { InvitationAcceptance } from '@/features/admin/components/InvitationAcceptance';
import { loginDestination } from '@/lib/auth';
import { getActor } from '@/lib/permissions';
import { workspaceEntries } from '@/lib/workspace-admission';

const invitationToken = /^[a-zA-Z0-9_-]{43}$/;

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!invitationToken.test(token)) notFound();
  const actor = await getActor();
  if (!actor) redirect(await loginDestination(`/invite/${token}`));
  const entries = workspaceEntries(actor);
  const destination = entries.studio ? '/studio' as const
    : entries.grading ? '/grading' as const
      : entries.admin ? '/admin' as const : '/app' as const;
  return <InvitationAcceptance token={token} destination={destination} canAccessAdmin={entries.admin !== null} />;
}
