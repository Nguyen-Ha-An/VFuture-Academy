'use client';

import { Label as DropdownMenuLabel } from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useRef, useState, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/classic';
import { routes } from '@/lib/routes';
import type { WorkspaceTheme } from '@/features/workspace-ui/theme';
import { LanguageMenuItems, LanguageSwitcher, ThemeMenuItems, ThemeSwitcher } from '@/features/workspace-ui/ui/ThemeSwitcher';

export type LearnerAccountProps = {
  studioDestination?: string | null;
  gradingDestination?: string | null;
  adminDestination?: string | null;
  userName?: string;
  /** Up to two letters (src/lib/initials.ts); the trigger shows them beside the name. */
  initials?: string;
  handle?: string;
  stacked?: boolean;
  onNavigate?: () => void;
  theme?: WorkspaceTheme;
};

const ACCOUNT_ROUTES = /^\/app\/(?:profile|leaderboard)(?:\/|$)/;

export function LearnerAccountActions({ studioDestination, gradingDestination, adminDestination, userName, initials, handle, stacked, onNavigate, theme = 'system' }: LearnerAccountProps) {
  const t = useTranslations('learner.focus');
  const shell = useTranslations('bench.learner.shell');
  const common = useTranslations('common');
  const pathname = usePathname();
  const accountLabel = userName || t('account');
  const formId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationTarget = useRef<string | null>(null);
  const focusHash = (url: URL) => {
    if (url.pathname !== window.location.pathname || !url.hash) return;
    let id = '';
    try { id = decodeURIComponent(url.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }); target.scrollIntoView?.({ block: 'start' }); }
  };
  const activateLink = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const url = new URL(event.currentTarget.href);
    navigationTarget.current = url.href;
    if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) {
      event.preventDefault();
      window.location.hash = url.hash;
      requestAnimationFrame(() => focusHash(url));
    }
    setMenuOpen(false);
    onNavigate?.();
  };
  const personal = [
    { href: routes.learner.profile(), label: t('profile') },
    { href: `${routes.learner.profile()}#certificates-heading`, label: t('certificates') },
    { href: `${routes.learner.profile()}#xp-heading`, label: 'XP' },
    { href: routes.learner.leaderboard(), label: t('leaderboard') },
  ];
  const workspaces = [
    { href: studioDestination, label: common('openStudio') },
    { href: gradingDestination, label: common('openGrading') },
    { href: adminDestination, label: common('openAdmin') },
  ].filter((link): link is { href: string; label: string } => Boolean(link.href));
  const signOutForm = <form id={formId} action={routes.auth.signout()} method="post" onSubmit={() => {
    try { localStorage.setItem('vfuture:auth:signed-out', String(Date.now())); } catch { /* Server sign-out remains authoritative. */ }
  }} />;
  const row = 'flex min-h-11 w-full items-center rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

  // The menu and this container set the row font: the sign-out <button> inherits its font (globals.css), so it matches the link rows.
  if (stacked) return <div className="mt-auto flex flex-col gap-1 border-t border-border pt-5 text-sm font-medium">
    {personal.map(link => <Link key={link.href} href={link.href} onClick={activateLink} className={row}>{link.label}</Link>)}
    {workspaces.length > 0 && <div className="my-2 h-px bg-border" role="separator" />}
    {workspaces.map(link => <Link key={link.href} href={link.href} onClick={activateLink} className={row}>{link.label}</Link>)}
    <div className="px-3 py-2"><LanguageSwitcher showLabel className="vf-l-drawer-seg" /></div>
    <div className="px-3 py-2"><ThemeSwitcher initial={theme} showLabel className="vf-l-drawer-seg" /></div>
    {signOutForm}<button type="submit" form={formId} className={row}>{common('signOut')}</button>
  </div>;

  return <div className="flex min-w-0 items-center gap-2">
    {signOutForm}
    <DropdownMenu modal={false} open={menuOpen} onOpenChange={open => { if (open) navigationTarget.current = null; setMenuOpen(open); }}>
      {/* aria-label keeps the name when the visible name is hidden (760 to 1099px, learner.css). */}
      <DropdownMenuTrigger asChild><button type="button" aria-label={accountLabel} title={accountLabel} data-active={ACCOUNT_ROUTES.test(pathname) || undefined} className="vf-l-account-trigger">
        {initials ? <span className="vf-l-account-initials" aria-hidden="true">{initials}</span> : null}
        <span className="vf-l-account-name truncate">{accountLabel}</span>
      </button></DropdownMenuTrigger>
      <DropdownMenuPortal><DropdownMenuContent align="end" className="text-sm" onCloseAutoFocus={event => {
        const destination = navigationTarget.current;
        if (destination) {
          event.preventDefault();
          requestAnimationFrame(() => focusHash(new URL(destination)));
        }
      }}>
        {userName ? <DropdownMenuLabel className="vf-l-account-label">
          <span className="block truncate text-sm font-medium">{userName}</span>
          {handle ? <span className="vf-meta block truncate">{shell('handle', { handle })}</span> : null}
        </DropdownMenuLabel> : null}
        {userName ? <DropdownMenuSeparator /> : null}
        {personal.map(link => <DropdownMenuItem key={link.href} asChild><Link href={link.href} onClick={activateLink}>{link.label}</Link></DropdownMenuItem>)}
        {workspaces.length > 0 && <DropdownMenuSeparator />}
        {workspaces.map(link => <DropdownMenuItem key={link.href} asChild><Link href={link.href} onClick={activateLink}>{link.label}</Link></DropdownMenuItem>)}
        <DropdownMenuSeparator />
        <LanguageMenuItems />
        <DropdownMenuSeparator />
        <ThemeMenuItems initial={theme} />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild onSelect={event => event.preventDefault()}><button type="submit" form={formId}>{common('signOut')}</button></DropdownMenuItem>
      </DropdownMenuContent></DropdownMenuPortal>
    </DropdownMenu>
  </div>;
}
