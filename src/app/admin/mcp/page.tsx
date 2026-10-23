import { forbidden } from 'next/navigation';

import { McpBlockView } from '@/features/admin/components/McpBlockView';
import { adminPageContext } from '@/features/admin/context';

export const dynamic = 'force-dynamic';

export default async function AdminMcpPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string | string[] }>;
}) {
  const [context, query] = await Promise.all([
    adminPageContext('user.manage.global'),
    searchParams,
  ]);
  if (context.scope.kind !== 'central') forbidden();

  return (
    <McpBlockView
      actorId={context.actor.userId}
      initialUserId={typeof query.userId === 'string' ? query.userId : ''}
    />
  );
}
