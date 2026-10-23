import type { Permission } from '@/lib/authorization';
import { routes } from '@/lib/routes';

export const adminGroups = ['overview', 'people', 'system'] as const;
export const adminNavigation = [
  { group: 'overview', key: 'overview', href: routes.admin.dashboard(), permissions: ['admin.access'], available: true, landing: true },
  { group: 'people', key: 'users', href: routes.admin.users(), permissions: ['member.read', 'user.manage.branch', 'user.manage.global'], available: true, landing: true },
  { group: 'people', key: 'branches', href: routes.admin.branches(), permissions: ['branch.read', 'user.manage.branch', 'user.manage.global'], available: true, landing: true },
  { group: 'system', key: 'roles', href: routes.admin.roles(), permissions: ['role.definition.read', 'role.definition.manage', 'role.assignment.branch', 'user.manage.global'], available: true, landing: true },
  { group: 'system', key: 'mcp', href: routes.admin.mcp(), permissions: ['user.manage.global'], available: true, landing: true },
  // Enrollment-version migration keeps its existing `course.publish` action permission.
  { group: 'system', key: 'enrollmentMigration', href: routes.admin.enrollmentMigration(), permissions: ['course.publish'], available: true, landing: true },
  { group: 'system', key: 'audit', href: routes.admin.audit(), permissions: ['audit.read'], available: true, landing: true },
] as const;

/**
 * Administrative entry is independent of Studio and grading permissions, and
 * requires a destination the permissions actually reach. A publisher holding
 * only `course.publish` therefore enters at enrollment-version migration
 * without gaining any general administration authority.
 */
export function firstAdminDestination(permissions: readonly Permission[]): string | null {
  return adminNavigation.find(item =>
    item.available && item.permissions.some(permission => permissions.includes(permission)))?.href ?? null;
}
