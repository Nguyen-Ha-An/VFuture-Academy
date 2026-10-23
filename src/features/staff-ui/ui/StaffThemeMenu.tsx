'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { workspaceThemes, type WorkspaceTheme } from '@/features/workspace-ui/theme';
import { useStaffTheme } from '../theme-client';

export const themeIcons = { system: Monitor, light: Sun, dark: Moon } as const satisfies Record<WorkspaceTheme, LucideIcon>;

/** System / Dark / Light as radio items; shared by the top-bar menu and (text-only) the user menu. */
export function StaffThemeRadioItems({ theme, onChange, icons = true }: { theme: WorkspaceTheme; onChange: (next: WorkspaceTheme) => void; icons?: boolean }) {
  const t = useTranslations('staffUi.shell.account.theme');
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={(value) => onChange(value as WorkspaceTheme)}>
      {workspaceThemes.map((option) => {
        const Icon = themeIcons[option];
        return (
          <DropdownMenuRadioItem key={option} value={option} onSelect={(event) => event.preventDefault()} className="leading-[1.4]">
            {icons ? <Icon aria-hidden="true" /> : null}
            {t(option)}
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}

export function StaffThemeMenu({ theme: initial }: { theme: WorkspaceTheme }) {
  const t = useTranslations('staffUi.shell.account.theme');
  const [theme, setTheme] = useStaffTheme(initial);
  const Icon = themeIcons[theme];
  // Non-modal like LearnerAccountActions: a modal menu aria-hides the page around focusable content (axe aria-hidden-focus).
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" title={t('label')}>
          <Icon className="size-4" aria-hidden="true" />
          <span className="sr-only">{t('label')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground leading-[1.4]">{t('label')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <StaffThemeRadioItems theme={theme} onChange={setTheme} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
