'use client';

import { useId } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronsUpDown, LogOut, Settings } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLocaleChange } from '@/components/LocaleSwitcher';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { RECOVERY_SIGNED_OUT_KEY } from '@/features/studio/recovery/tab';
import type { WorkspaceTheme } from '@/features/workspace-ui/theme';
import type { AppLocale } from '@/i18n/request';
import { routes } from '@/lib/routes';
import type { WorkspaceEntries } from '@/lib/workspace-navigation';
import type { StaffWorkspace } from '@/lib/workspaces';
import { useStaffTheme } from '../theme-client';
import type { StaffIdentity } from '../types';
import { StaffThemeRadioItems } from './StaffThemeMenu';

const LOCALES = ['vi', 'en'] as const satisfies readonly AppLocale[];

/**
 * The notebook route sends COEP, which blocks cross-origin images, so only same-origin paths and
 * data: images render; anything else shows initials. Decided without `window` so SSR and hydration agree.
 */
export function isRenderableAvatar(url: string | null | undefined): url is string {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  return url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');
}

function IdentityBlock({ identity, name }: { identity: StaffIdentity; name: string }) {
  return (
    <>
      <Avatar className="size-8 rounded-full">
        {isRenderableAvatar(identity.avatarUrl) ? <AvatarImage src={identity.avatarUrl} alt="" /> : null}
        <AvatarFallback className="rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-accent-foreground" aria-hidden="true">
          {identity.initials || name.slice(0, 1).toLocaleUpperCase('vi')}
        </AvatarFallback>
      </Avatar>
      <span className="grid min-w-0 flex-1 text-left leading-[1.4]">
        <span className="truncate text-sm font-medium">{name}</span>
        {identity.email ? <span className="truncate text-xs text-muted-foreground">{identity.email}</span> : null}
      </span>
    </>
  );
}

export function StaffUserMenu({ identity, workspace, theme: initialTheme }: { identity: StaffIdentity; workspace: StaffWorkspace; theme: WorkspaceTheme; entries: WorkspaceEntries }) {
  const common = useTranslations('common');
  const localeT = useTranslations('locale');
  const t = useTranslations('staffUi.shell.account');
  const { isMobile } = useSidebar();
  const { locale, changeLocale, isPending, error } = useLocaleChange();
  const [theme, setTheme] = useStaffTheme(initialTheme);
  const formId = useId();
  const name = identity.name || t('fallbackName');

  return (
    <SidebarMenu data-workspace={workspace}>
      <SidebarMenuItem>
        <form
          id={formId}
          action={routes.auth.signout()}
          method="post"
          hidden
          onSubmit={() => {
            try { localStorage.setItem(RECOVERY_SIGNED_OUT_KEY, String(Date.now())); } catch { /* Server sign-out remains authoritative. */ }
          }}
        />
        {/* Non-modal like LearnerAccountActions: a modal menu aria-hides the page around focusable content (axe aria-hidden-focus). */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" tooltip={name} className="h-12 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <IdentityBlock identity={identity} name={name} />
              <ChevronsUpDown className="ml-auto size-4" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4} className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-md text-sm leading-[1.4]">
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5">
                <IdentityBlock identity={identity} name={name} />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild className="leading-[1.4]">
                <Link href={routes.learner.dashboard()}><BookOpen aria-hidden="true" />{common('openLearning')}</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="leading-[1.4]">
                <Link href={routes.learner.profile()}><Settings aria-hidden="true" />{common('accountSettings')}</Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {/* Text-only group labels and radio rows, so Language and Theme options share one text column. */}
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground leading-[1.4]">{common('language')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={locale} onValueChange={(value) => { if (value !== locale) changeLocale(value as AppLocale); }}>
                {LOCALES.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option} lang={option} disabled={isPending} onSelect={(event) => event.preventDefault()} className="leading-[1.4]">
                    {localeT(option)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {error ? <p role="alert" className="px-2 py-1.5 text-xs text-destructive leading-[1.4]">{error}</p> : null}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground leading-[1.4]">{t('theme.label')}</DropdownMenuLabel>
              <StaffThemeRadioItems theme={theme} onChange={setTheme} icons={false} />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()} className="w-full leading-[1.4]">
              <button type="submit" form={formId}><LogOut aria-hidden="true" />{common('signOut')}</button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
