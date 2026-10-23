import { MemberProfile } from '@/features/admin/components/MemberProfile';
import { adminPageContext } from '@/features/admin/context';

export default async function MemberPage({ params }: { params: Promise<{ userId: string }> }) {
  const [context, { userId }] = await Promise.all([adminPageContext('member.read'), params]);
  return (
    <MemberProfile
      userId={userId}
      scope={context.scope}
      actorId={context.actor.userId}
      canManageMcpAccess={context.scope.kind === 'central' && context.permissions.includes('user.manage.global')}
    />
  );
}
