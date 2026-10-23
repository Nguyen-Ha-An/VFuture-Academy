import type { LucideIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { owningSection } from '@/components/ShellPrimitives';
import type { Permission } from '@/lib/permissions';
import { shellNavigation, workspaceNavigationFor, type WorkspaceNavItem } from '@/lib/workspace-navigation';
import type { StaffWorkspace } from '@/lib/workspaces';
import { navIcon } from './nav-icons';

export type StaffNavSection = { key: string; href: string; label: string; icon: LucideIcon };
export type StaffNavItem = {
  key: string;
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  /** Labelled child sections living at other URLs (e.g. Library → Resources); ⌘K lists them. */
  sections?: StaffNavSection[];
};
export type StaffNavGroup = { key: string; label?: string; items: StaffNavItem[] };
export type StaffNavigation = { label: string; groups: StaffNavGroup[] };

/** Message namespace holding each workspace's nav labels (the same ones the legacy shells use). */
export const STAFF_NAV_NAMESPACE = {
  studio: 'studioNav',
  grading: 'gradingNav',
  admin: 'adminNav',
} as const satisfies Record<StaffWorkspace, string>;

const DEFAULT_GROUP = 'main';

/** Course authoring (`/studio/courses/:id…`) gets the full-bleed editor layout; same test as StaffShell. */
export function isCourseEditorRoute(workspace: StaffWorkspace, pathname: string) {
  return workspace === 'studio' && /^\/studio\/courses\/[^/]+/.test(pathname);
}

/** The course workspace page itself, whose editor fills the viewport height on wide screens (StaffShell's `staff-course-editor`). */
export function isCourseWorkspacePage(workspace: StaffWorkspace, pathname: string) {
  return workspace === 'studio' && /^\/studio\/courses\/[^/]+\/?$/.test(pathname);
}

function groupOf(item: WorkspaceNavItem) {
  const group = (item as WorkspaceNavItem & { group?: unknown }).group;
  return typeof group === 'string' ? group : DEFAULT_GROUP;
}

/**
 * Pure navigation model: permission-filtered items (`workspaceNavigationFor`), labelled via
 * `shellNavigation`, grouped by the nav data's `group` field when present, with exactly one
 * active item chosen by ShellPrimitives' `owningSection` (longest prefix, child sections
 * included), which matches the legacy shells' active item on every route.
 */
export function staffNavigation(
  workspace: StaffWorkspace,
  permissions: readonly Permission[],
  pathname: string,
  translate: { item: (key: string) => string; navigation: string },
): StaffNavigation {
  const source = workspaceNavigationFor(workspace, permissions);
  const labelled = shellNavigation(source, translate.item);
  const owner = owningSection(pathname, labelled);
  const items = labelled.map((item, index) => {
    const sourceMatches = source[index].matches ?? [];
    const sections = sourceMatches.flatMap((match) => (match.key ? [{ key: match.key, href: match.href, label: translate.item(match.key), icon: navIcon(match.key) }] : []));
    return {
      group: groupOf(source[index]),
      item: {
        key: item.key,
        href: item.href,
        label: item.label,
        icon: navIcon(item.key),
        active: owner?.item.key === item.key,
        ...(sections.length ? { sections } : {}),
      } satisfies StaffNavItem,
    };
  });
  const groups: StaffNavGroup[] = [];
  for (const { group, item } of items) {
    let target = groups.find((candidate) => candidate.key === group);
    if (!target) {
      target = { key: group, items: [] };
      groups.push(target);
    }
    target.items.push(item);
  }
  for (const group of groups) {
    // A group that only repeats its single item's name (admin "Overview") stays unlabelled.
    const redundant = group.items.length === 1 && group.items[0].key === group.key;
    if (group.key !== DEFAULT_GROUP && !redundant) group.label = translate.item(group.key);
  }
  return { label: translate.navigation, groups };
}

/** Accessible name of a workspace's navigation landmark, as the legacy shells name it. */
export function useStaffNavigationLabel(workspace: StaffWorkspace) {
  const common = useTranslations('common');
  const t = useTranslations(STAFF_NAV_NAMESPACE[workspace]);
  return workspace === 'admin' ? t('navigation') : common(workspace === 'studio' ? 'studioNavigation' : 'gradingNavigation');
}

export function useStaffNavigation(workspace: StaffWorkspace, permissions: readonly Permission[]): StaffNavigation {
  const pathname = usePathname() ?? '';
  const t = useTranslations(STAFF_NAV_NAMESPACE[workspace]);
  const label = useStaffNavigationLabel(workspace);
  return useMemo(
    () => staffNavigation(workspace, permissions, pathname, { item: (key) => t(key), navigation: label }),
    [workspace, permissions, pathname, t, label],
  );
}
