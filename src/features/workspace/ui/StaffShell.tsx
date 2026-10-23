"use client";

import * as Dropdown from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, UserRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrandLink, MenuButton, MobileNavigationDrawer, NavigationList, ShellBreadcrumbs } from '@/components/ShellPrimitives';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { AdminScopeSelector } from '@/features/admin/components/AdminScopeSelector';
import type { AdminScope, AdminScopeOption } from '@/lib/admin-scope';
import type { Permission } from '@/lib/permissions';
import { routes } from '@/lib/routes';
import { shellNavigation, workspaceNavigationFor, type WorkspaceEntries } from '@/lib/workspace-navigation';
import { workspaceHome, type StaffWorkspace } from '@/lib/workspaces';
import { StaffTitleContext } from './StaffTitleContext';
import './staff.css';

export type StaffShellProps = {
  workspace: StaffWorkspace;
  children: ReactNode;
  permissions: Permission[];
  userName?: string;
  scopeOptions?: AdminScopeOption[];
  activeScope?: AdminScope;
  entries?: WorkspaceEntries;
};

export function StaffShell({ workspace, children, permissions, userName, scopeOptions, activeScope, entries }: StaffShellProps) {
  const pathname = usePathname();
  const common = useTranslations('common');
  const t = useTranslations(workspace === 'studio' ? 'studioNav' : workspace === 'grading' ? 'gradingNav' : 'adminNav');
  const vi = useLocale() === 'vi';
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const [recordTitle, setRecordTitle] = useState<{ pathname: string; title: string; token: object } | null>(null);
  const registerTitle = useCallback((title: string) => {
    const token = {};
    setRecordTitle({ pathname, title, token });
    return () => setRecordTitle(current => current?.token === token ? null : current);
  }, [pathname]);
  const navigation = useMemo(() => shellNavigation(workspaceNavigationFor(workspace, permissions), key => t(key)), [workspace, permissions, t]);
  const editor = workspace === 'studio' && /^\/studio\/courses\/[^/]+/.test(pathname);
  const title = common(workspace === 'studio' ? 'workspaceStudio' : workspace === 'grading' ? 'workspaceGrading' : 'workspaceAdmin');
  const navLabel = workspace === 'admin' ? t('navigation') : common(workspace === 'studio' ? 'studioNavigation' : 'gradingNavigation');
  const mainId = `${workspace}-main`;
  useEffect(() => {
    setDrawerOpen(false);
    const heading = document.querySelector<HTMLElement>(`#${mainId} h1`);
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [pathname, mainId]);
  const accountMenu = <Dropdown.Root><Dropdown.Trigger asChild><button type="button" className="inline-flex min-h-11 max-w-48 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium" aria-label={userName || (vi ? 'Tài khoản' : 'Account')}><UserRound className="size-4 shrink-0" aria-hidden="true" /><span className="hidden truncate sm:inline">{userName || (vi ? 'Tài khoản' : 'Account')}</span><ChevronDown className="size-3 shrink-0" aria-hidden="true" /></button></Dropdown.Trigger><Dropdown.Portal><Dropdown.Content align="end" className="staff-workspace z-[60] min-w-60 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-2 shadow-lg">
    <Dropdown.Item asChild><Link className="staff-account-item" href={routes.learner.profile()}>{common('accountSettings')}</Link></Dropdown.Item>
    <Dropdown.Item asChild><Link className="staff-account-item" href={routes.learner.dashboard()}>{common('openLearning')}</Link></Dropdown.Item>
    <Dropdown.Separator className="my-2 h-px bg-border" />
    <form action={routes.auth.signout()} method="post"><Dropdown.Item asChild onSelect={event => event.preventDefault()}><button type="submit" className="staff-account-item">{common('signOut')}</button></Dropdown.Item></form>
  </Dropdown.Content></Dropdown.Portal></Dropdown.Root>;
  const switcher = (stacked = false) => entries ? <WorkspaceSwitcher entries={entries} active={workspace} stacked={stacked} onNavigate={() => setDrawerOpen(false)} /> : null;
  const scope = activeScope && scopeOptions ? <AdminScopeSelector options={scopeOptions} active={activeScope} endpoint={`/api/v1/${workspace}/scope`} destination={workspaceHome(workspace)} /> : null;
  return <StaffTitleContext.Provider value={registerTitle}><div className={`staff-workspace min-h-dvh ${editor && /^\/studio\/courses\/[^/]+\/?$/.test(pathname) ? 'staff-course-editor' : ''}`}>
    <a href={`#${mainId}`} className="fixed left-4 top-3 z-[70] -translate-y-20 rounded-md bg-foreground px-4 py-3 text-sm font-semibold text-background focus:translate-y-0">{common('skipToContent')}</a>
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="flex min-h-16 items-center justify-between gap-3 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-4"><BrandLink href={workspaceHome(workspace)} /><div className="hidden border-l border-border pl-4 lg:block">{switcher()}</div></div>
        <div className="flex shrink-0 items-center gap-2"><div className="staff-header-language hidden lg:block"><LocaleSwitcher /></div>{accountMenu}<MenuButton ref={menuRef} expanded={drawerOpen} controls={`${workspace}-mobile-navigation`} onClick={() => setDrawerOpen(true)} /></div>
      </div>
      {editor ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2 lg:px-6"><nav aria-label={navLabel} className="hidden lg:block"><NavigationList items={navigation} pathname={pathname} /></nav><div className="staff-scope w-full lg:max-w-64">{scope}</div></div> : null}
    </header>
    <div className={`staff-shell-body ${editor ? '' : 'lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]'}`}>
      {!editor ? <aside className="hidden border-r border-border bg-card lg:sticky lg:top-16 lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col">
        <div className="staff-scope border-b border-border p-4">{scope}</div>
        <nav aria-label={navLabel} className="min-h-0 flex-1 overflow-auto px-3 py-5"><p className="px-3 pb-3 text-xs font-semibold text-muted-foreground">{title}</p><NavigationList items={navigation} pathname={pathname} vertical /></nav>
      </aside> : null}
      <div className="min-w-0">{!editor && scope ? <div className="staff-scope border-b border-border px-4 py-3 lg:hidden">{scope}</div> : null}
        <main id={mainId} className={editor ? 'min-w-0 px-3 py-3 sm:px-4 lg:px-6' : 'mx-auto w-full min-w-0 max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8'}>
          {!editor ? <ShellBreadcrumbs pathname={pathname} items={navigation} currentLabel={recordTitle?.pathname === pathname ? recordTitle.title : undefined} /> : null}
          {children}
        </main>
      </div>
    </div>
    <MobileNavigationDrawer id={`${workspace}-mobile-navigation`} open={drawerOpen} onOpenChange={setDrawerOpen} title={navLabel} returnFocusRef={menuRef} themeClassName="staff-workspace">
      <nav aria-label={navLabel}><NavigationList items={navigation} pathname={pathname} vertical onNavigate={() => setDrawerOpen(false)} /></nav>
      {entries ? <div className="mt-4 border-t border-border pt-4">{switcher(true)}</div> : null}
      <div className="mt-4 border-t border-border px-3 pt-4"><LocaleSwitcher /></div>
      <Link href={routes.learner.dashboard()} onClick={() => setDrawerOpen(false)} className="mt-auto inline-flex min-h-11 items-center border-t border-border px-3 pt-3 text-sm">{common('openLearning')}</Link>
    </MobileNavigationDrawer>
  </div></StaffTitleContext.Provider>;
}
