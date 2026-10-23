import type { Permission } from '@/lib/authorization';
import { adminNavigation, firstAdminDestination } from '@/lib/admin-navigation';
import { firstGradingDestination, gradingNavigation } from '@/lib/grading-navigation';
import { firstStudioDestination, studioNavigation } from '@/lib/studio-navigation';
import { STAFF_WORKSPACES, workspaceHome, workspaceScopedPermissions, type StaffWorkspace } from '@/lib/workspaces';

export type WorkspaceNavMatch = { href: string; key?: string };

export type WorkspaceNavItem = {
  key: string;
  href: string;
  permissions: readonly Permission[];
  available: boolean;
  /** Child sections that live at other URLs but belong under this item (active state + breadcrumbs). */
  matches?: readonly WorkspaceNavMatch[];
};

/** Shell-ready items: labels resolved, child sections labelled when they carry a key. */
export function shellNavigation(items: readonly WorkspaceNavItem[], label: (key: string) => string) {
  return items.map(item => ({
    key: item.key,
    href: item.href,
    label: label(item.key),
    ...(item.matches ? { matches: item.matches.map(match => ({ href: match.href, ...(match.key ? { label: label(match.key) } : {}) })) } : {}),
  }));
}

export const WORKSPACE_NAVIGATION: Readonly<Record<StaffWorkspace, readonly WorkspaceNavItem[]>> = Object.freeze({
  studio: studioNavigation,
  grading: gradingNavigation,
  admin: adminNavigation,
});

/** Navigation items the held permissions actually reach inside one workspace. */
export function workspaceNavigationFor(
  workspace: StaffWorkspace,
  permissions: readonly Permission[],
): WorkspaceNavItem[] {
  return WORKSPACE_NAVIGATION[workspace].filter((item) =>
    item.available && item.permissions.some((permission) => permissions.includes(permission)));
}

/** The landing destination for one workspace, or null when nothing is reachable. */
export function firstWorkspaceDestination(
  workspace: StaffWorkspace,
  permissions: readonly Permission[],
): string | null {
  const scoped = workspaceScopedPermissions(workspace, permissions);
  if (workspace === 'studio') return firstStudioDestination(scoped);
  if (workspace === 'grading') return firstGradingDestination(scoped);
  return firstAdminDestination(scoped);
}

/** Workspace entry requires a real destination, never a bare permission. */
export function canEnterWorkspace(
  workspace: StaffWorkspace,
  permissions: readonly Permission[],
): boolean {
  return firstWorkspaceDestination(workspace, permissions) !== null;
}

export type WorkspaceEntries = Readonly<Record<StaffWorkspace, string | null>>;

/**
 * Resolves a switcher entry for every workspace the permissions can enter.
 *
 * The entry is the workspace landing page, never a deep destination: a deep
 * destination derived from permissions pooled across scopes can be unreachable
 * in the scope that workspace actually activates (grading in one school,
 * reports in another). The landing page resolves its own active scope and lists
 * only what that scope reaches.
 */
export function workspaceEntriesFor(permissions: readonly Permission[]): WorkspaceEntries {
  return Object.freeze(Object.fromEntries(STAFF_WORKSPACES.map((workspace) =>
    [workspace, canEnterWorkspace(workspace, permissions) ? workspaceHome(workspace) : null],
  )) as Record<StaffWorkspace, string | null>);
}

/** Entries for an actor whose workspace admission was resolved per scope. */
export function workspaceEntriesFromAdmission(
  enterable: (workspace: StaffWorkspace) => boolean,
): WorkspaceEntries {
  return Object.freeze(Object.fromEntries(STAFF_WORKSPACES.map((workspace) =>
    [workspace, enterable(workspace) ? workspaceHome(workspace) : null],
  )) as Record<StaffWorkspace, string | null>);
}
