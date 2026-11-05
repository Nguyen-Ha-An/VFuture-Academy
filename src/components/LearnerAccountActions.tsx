'use client';

import { useTranslations } from 'next-intl';
import type { WorkspaceTheme } from '@/features/workspace-ui/theme';
import { CanvasButton } from '@/features/canvas/ui/controls';
import { AccountTray, ACCOUNT_TRAY_ID, useAccountTrayController } from '@/features/canvas/ui/AccountTray';

export type LearnerAccountProps = {
  studioDestination?: string | null;
  gradingDestination?: string | null;
  adminDestination?: string | null;
  userName?: string;
  initials?: string;
  handle?: string;
  stacked?: boolean;
  onNavigate?: () => void;
  theme?: WorkspaceTheme;
};

/** Compatibility entrypoint for shells without the global rail. It uses the same account surface. */
export function LearnerAccountActions({ userName, initials, handle, theme = 'system' }: LearnerAccountProps) {
  const t = useTranslations('learner.focus');
  const account = useAccountTrayController();
  return <>
    <CanvasButton variant="outline" aria-haspopup="dialog" aria-expanded={account.open} aria-controls={ACCOUNT_TRAY_ID} onClick={account.onAccount}>{t('account')}</CanvasButton>
    <AccountTray open={account.open} onOpenChange={account.setOpen} restoreFocus={account.restoreFocus} identity={{ name: userName, initials, handle }} theme={theme} />
  </>;
}
