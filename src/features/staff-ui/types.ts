import type { WorkspaceTheme } from '@/features/workspace-ui/theme';

/** Who is signed in, as the staff shell shows it. `name` is empty when neither a display name nor an email is known; the UI supplies its localized fallback. */
export type StaffIdentity = { name: string; email: string | null; avatarUrl: string | null; initials: string };

/** Per-request chrome state the staff shell renders on the server so the first paint matches the client. */
export type StaffChrome = { theme: WorkspaceTheme; sidebarOpen: boolean; identity: StaffIdentity };
