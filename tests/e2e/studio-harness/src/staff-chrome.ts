import type { StaffChrome, StaffIdentity } from '../../../../src/features/staff-ui/types';
import { parseSidebarOpen, SIDEBAR_STATE_COOKIE } from '../../../../src/features/staff-ui/sidebar-state';
import { parseWorkspaceTheme, WORKSPACE_THEME_COOKIE } from '../../../../src/features/workspace-ui/theme';

/**
 * Browser-harness-only stand-in for `readStaffChrome()`, shared by the studio and admin harnesses.
 * Under `?uiv2=1` (see staff-shell-fixture.tsx), `?theme=dark|light|system` and
 * `?sidebar=collapsed|expanded` pin the chrome, otherwise the same cookies the server reads
 * (`vf-theme`, `sidebar_state`) apply, so a toggle survives a reload exactly as in the app.
 */
export const STAFF_FIXTURE_IDENTITY: StaffIdentity = {
  name: 'Nguyễn Thị Thanh Hương',
  email: 'huong.nguyen@vfuture.test',
  avatarUrl: null,
  initials: 'TH',
};

function cookie(name: string): string | undefined {
  return document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function staffChromeFixture(params = new URLSearchParams(location.search)): StaffChrome {
  const sidebar = params.get('sidebar');
  return {
    theme: parseWorkspaceTheme(params.get('theme') ?? cookie(WORKSPACE_THEME_COOKIE)),
    sidebarOpen: sidebar === 'collapsed' ? false : sidebar === 'expanded' ? true : parseSidebarOpen(cookie(SIDEBAR_STATE_COOKIE)),
    identity: STAFF_FIXTURE_IDENTITY,
  };
}
