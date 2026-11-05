'use client';

import { useTranslations } from 'next-intl';
import { CanvasButton } from '@/features/canvas/ui/controls';
import { AccountTray, ACCOUNT_TRAY_ID, useAccountTrayController } from '@/features/canvas/ui/AccountTray';
import type { WorkspaceTheme } from '@/features/workspace-ui/theme';
import type { WorkspaceEntries } from '@/lib/workspace-navigation';
import type { StaffWorkspace } from '@/lib/workspaces';
import type { StaffIdentity } from '../types';

export { isRenderableAvatar } from '@/features/canvas/ui/AccountTray';

/** Legacy entrypoint only; current staff chrome uses Account on the global rail. */
export function StaffUserMenu({ identity, theme }: { identity: StaffIdentity; workspace: StaffWorkspace; theme: WorkspaceTheme; entries: WorkspaceEntries }) {
  const t = useTranslations('learner.focus');
  const account = useAccountTrayController();
  return <>
    <CanvasButton variant="outline" aria-haspopup="dialog" aria-expanded={account.open} aria-controls={ACCOUNT_TRAY_ID} onClick={account.onAccount}>{t('account')}</CanvasButton>
    <AccountTray open={account.open} onOpenChange={account.setOpen} restoreFocus={account.restoreFocus} identity={identity} theme={theme} />
  </>;
}
