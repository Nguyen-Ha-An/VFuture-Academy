import 'server-only';
import { cookies } from 'next/headers';
import { readWorkspaceTheme } from '@/features/workspace-ui/theme.server';
import { staffIdentity } from './identity.server';
import { parseSidebarOpen, SIDEBAR_STATE_COOKIE } from './sidebar-state';
import type { StaffChrome } from './types';

export { parseSidebarOpen, SIDEBAR_STATE_COOKIE };

export async function readStaffChrome(): Promise<StaffChrome> {
  const [theme, sidebarOpen, identity] = await Promise.all([
    readWorkspaceTheme().catch(() => 'system' as const),
    cookies().then((store) => parseSidebarOpen(store.get(SIDEBAR_STATE_COOKIE)?.value)).catch(() => true),
    staffIdentity(),
  ]);
  return { theme, sidebarOpen, identity };
}
