import { MembersDirectory } from '@/features/admin/components/MembersDirectory';
import { adminPageContext } from '@/features/admin/context';
import { memberStats } from '@/features/admin/member-stats';

export default async function UsersPage() {
  const context = await adminPageContext('member.read');
  const stats = await memberStats(context);
  return <MembersDirectory scope={context.scope} actorId={context.actor.userId} stats={stats} />;
}
