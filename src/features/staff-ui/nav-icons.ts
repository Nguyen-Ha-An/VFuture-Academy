import {
  ArrowRightLeft,
  BookOpen,
  Briefcase,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FolderKanban,
  ImageIcon,
  Inbox,
  LayoutDashboard,
  Library,
  ListChecks,
  PlugZap,
  School,
  ScrollText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { adminNavigation } from '@/lib/admin-navigation';
import type { gradingNavigation } from '@/lib/grading-navigation';
import type { studioNavigation } from '@/lib/studio-navigation';

type NavEntry = (typeof studioNavigation)[number] | (typeof gradingNavigation)[number] | (typeof adminNavigation)[number];
type MatchOf<T> = T extends { matches: readonly (infer M)[] } ? M : never;

/** Every top-level nav key across the three staff workspaces (derived from the nav data). */
export type NavKey = NavEntry['key'];
/** Keys of labelled child sections (e.g. Library → Resources), which the command menu lists too. */
export type NavSectionKey = MatchOf<NavEntry> extends infer M ? (M extends { key: infer K extends string } ? K : never) : never;

/**
 * Lucide icon per nav key. `satisfies` makes a key added to the nav data without an icon
 * (or an icon for a key that no longer exists) fail typecheck; `src/lib` stays UI-free.
 */
export const navIcons = {
  home: LayoutDashboard,
  overview: LayoutDashboard,
  courses: BookOpen,
  library: Library,
  questionBank: ListChecks,
  reviews: ClipboardCheck,
  mcp: PlugZap,
  assessments: ClipboardList,
  queue: Inbox,
  reports: ChartColumn,
  users: Users,
  branches: School,
  roles: ShieldCheck,
  enrollmentMigration: ArrowRightLeft,
  audit: ScrollText,
  resources: FileText,
  opportunities: Briefcase,
  projects: FolderKanban,
  media: ImageIcon,
} satisfies Record<NavKey | NavSectionKey, LucideIcon>;

export function navIcon(key: string): LucideIcon {
  return (navIcons as Record<string, LucideIcon>)[key] ?? LayoutDashboard;
}
