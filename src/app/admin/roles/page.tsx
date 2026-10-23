import { forbidden } from 'next/navigation';

import { RoleManager } from '@/features/admin/components/RoleManager';
import { adminPageContext } from '@/features/admin/context';

export default async function RolesPage() {
  const context = await adminPageContext();
  const canViewRoles = context.permissions.some((permission) =>
    permission === 'role.definition.read'
    || permission === 'role.definition.manage'
    || permission === 'role.assignment.branch');
  if (!canViewRoles) forbidden();
  return <RoleManager scope={context.scope} actorId={context.actor.userId} />;
}
