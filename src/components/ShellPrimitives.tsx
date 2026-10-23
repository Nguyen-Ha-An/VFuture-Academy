"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { forwardRef, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

/** `matches` are child sections that live outside the item's URL (e.g. /studio/resources under Library). */
export type ShellNavMatch = { href: string; label?: string };
export type ShellNavItem = { key: string; href: string; label: string; matches?: readonly ShellNavMatch[] };

const WORKSPACE_ROOTS = [
  routes.learner.dashboard(),
  routes.studio.dashboard(),
  routes.grading.dashboard(),
  routes.admin.dashboard(),
];

function pathWithin(pathname: string, href: string) {
  const workspaceRoot = WORKSPACE_ROOTS.includes(href);
  return pathname === href || (!workspaceRoot && pathname.startsWith(`${href}/`));
}

export function isNavigationItemActive(pathname: string, href: string, matches?: readonly ShellNavMatch[]) {
  return pathWithin(pathname, href) || Boolean(matches?.some(match => pathWithin(pathname, match.href)));
}

/** The item (and child section, when matched through one) that owns a pathname; the longest prefix wins. */
export function owningSection<T extends ShellNavItem>(pathname: string, items: readonly T[]) {
  const candidates = items.flatMap(item => [
    ...(pathWithin(pathname, item.href) ? [{ item, base: item.href, section: undefined as ShellNavMatch | undefined }] : []),
    ...(item.matches ?? []).filter(match => pathWithin(pathname, match.href)).map(match => ({ item, base: match.href, section: match })),
  ]);
  return candidates.sort((a, b) => b.base.length - a.base.length)[0];
}

export function BrandLink({ href }: { href: string }) {
  const common = useTranslations("common");
  return <Link href={href} className="inline-flex min-h-11 items-center gap-3 rounded-md font-semibold tracking-[-0.02em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary font-mono text-xs text-primary-foreground" aria-hidden="true">VF</span><span>{common("brand")}</span></Link>;
}

export const MenuButton = forwardRef<HTMLButtonElement, { onClick: () => void; controls: string; expanded?: boolean; className?: string }>(function MenuButton({ onClick, controls, expanded, className }, ref) {
  const common = useTranslations("common");
  return <button ref={ref} type="button" aria-label={common("menu")} aria-controls={controls} aria-haspopup="dialog" aria-expanded={expanded} onClick={onClick} className={cn("inline-flex size-11 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:hidden", className)}><Menu aria-hidden="true" className="size-5" /></button>;
});

/** `closeAt` is the media query at which the bar shows its own nav, so the drawer closes (staff bars: 64rem). */
export function MobileNavigationDrawer({ children, open, onOpenChange, title, id, returnFocusRef, themeClassName, closeAt = '(min-width: 64rem)' }: { children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; title: string; id: string; returnFocusRef: RefObject<HTMLButtonElement | null>; themeClassName?: string; closeAt?: string }) {
  const common = useTranslations("common");
  const closeReason = useRef<'dismiss' | 'breakpoint' | 'navigate'>('dismiss');
  useEffect(() => {
    if (!open) return;
    closeReason.current = 'dismiss';
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(closeAt);
    const closeOnDesktop = ({ matches }: { matches: boolean }) => {
      if (matches) { closeReason.current = 'breakpoint'; onOpenChange(false); }
    };
    closeOnDesktop(media);
    media.addEventListener('change', closeOnDesktop);
    return () => media.removeEventListener('change', closeOnDesktop);
  }, [open, onOpenChange, closeAt]);

  return <Dialog.Root open={open} onOpenChange={next => { if (!next) closeReason.current = 'dismiss'; onOpenChange(next); }}><Dialog.Portal>
    <Dialog.Overlay className={cn(themeClassName, "fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px]")} />
    <Dialog.Content id={id} aria-describedby={undefined} onClickCapture={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (link && link.target !== '_blank' && (link.href !== window.location.href || new URL(link.href).hash)) closeReason.current = 'navigate';
    }} onCloseAutoFocus={event => {
      event.preventDefault();
      if (closeReason.current === 'navigate') return;
      if (closeReason.current === 'breakpoint') {
        const target = document.querySelector<HTMLElement>('header a[aria-current="page"], main h1, main');
        if (target) { if (!target.matches('a, button, input, select, textarea')) target.tabIndex = -1; target.focus({ preventScroll: true }); }
        return;
      }
      returnFocusRef.current?.focus();
    }} className={cn(themeClassName, "fixed inset-y-0 left-0 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col border-r border-border bg-background p-5 text-foreground shadow-2xl focus:outline-none lg:hidden")}>
      <div className="flex items-center justify-between gap-4 border-b border-border pb-4"><Dialog.Title className="text-base font-semibold">{title}</Dialog.Title><Dialog.Close aria-label={common("close")} className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><X aria-hidden="true" className="size-5" /></Dialog.Close></div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain py-5">{children}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function NavigationList({ items, pathname, vertical = false, onNavigate }: { items: ShellNavItem[]; pathname: string; vertical?: boolean; onNavigate?: () => void }) {
  return <ul className={cn(vertical ? "space-y-1" : "flex items-center gap-1")}>{items.map((item) => { const active = isNavigationItemActive(pathname, item.href, item.matches); return <li key={item.key}><Link href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate} className={cn("inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", vertical && "w-full", active ? "bg-accent text-accent-foreground" : "text-muted-foreground")}>{item.label}</Link></li>; })}</ul>;
}

function readableSegment(segment: string) {
  try { return decodeURIComponent(segment).replace(/[-_]+/g, " "); } catch { return segment.replace(/[-_]+/g, " "); }
}

export type ShellBreadcrumb = { label: string; href: string };

/**
 * The breadcrumb trail below the owning nav item: a labelled child section, then each
 * readable path segment (structural segments such as `items` are skipped). Null when no
 * item owns the pathname.
 */
export function breadcrumbTrail<T extends ShellNavItem>(pathname: string, items: readonly T[]): { parent: T; crumbs: ShellBreadcrumb[] } | null {
  const owner = owningSection(pathname, items);
  if (!owner) return null;
  const remaining = pathname.slice(owner.base.length).split("/").filter(Boolean);
  const sectionCrumb = owner.section?.label ? [{ label: owner.section.label, href: owner.section.href, structural: false }] : [];
  const crumbs = [...sectionCrumb, ...remaining.map((segment, index) => ({ label: readableSegment(segment), href: `${owner.base}/${remaining.slice(0, index + 1).join("/")}`, structural: ["items", "assignments", "exams"].includes(segment) })).filter((crumb) => !crumb.structural)];
  return { parent: owner.item, crumbs: crumbs.map(({ label, href }) => ({ label, href })) };
}

export function ShellBreadcrumbs({ pathname, items, currentLabel }: { pathname: string; items: ShellNavItem[]; currentLabel?: string }) {
  const common = useTranslations("common");
  const trail = breadcrumbTrail(pathname, items);
  if (!trail) return null;
  const { parent, crumbs } = trail;
  return <nav aria-label={common("breadcrumbs")} className="mb-5 overflow-x-auto"><ol className="flex min-w-max items-center gap-2 text-sm text-muted-foreground"><li>{crumbs.length ? <Link href={parent.href} className="rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{parent.label}</Link> : <span aria-current="page" className="text-foreground">{parent.label}</span>}</li>{crumbs.map((crumb, index) => { const current = index === crumbs.length - 1; return <li key={crumb.href} className="flex items-center gap-2"><span aria-hidden="true">/</span>{current ? <span aria-current="page" className="max-w-64 truncate capitalize text-foreground">{currentLabel || crumb.label}</span> : <Link href={crumb.href} className="max-w-64 truncate capitalize hover:text-foreground hover:underline">{crumb.label}</Link>}</li>; })}</ol></nav>;
}

export function AccountActions({ profileHref, workspaceHref, workspaceLabel, secondaryWorkspaceHref, secondaryWorkspaceLabel, userName, onNavigate, stacked = false }: { profileHref: string; workspaceHref?: string; workspaceLabel?: string; secondaryWorkspaceHref?: string; secondaryWorkspaceLabel?: string; userName?: string; onNavigate?: () => void; stacked?: boolean }) {
  const common = useTranslations("common");
  return <div className={cn("flex items-center gap-2", stacked && "mt-auto flex-col items-stretch border-t border-border pt-5")}>{userName ? <span className={cn("max-w-40 truncate text-sm font-medium", stacked && "max-w-none px-3")}>{userName}</span> : null}{workspaceHref && workspaceLabel ? <Link href={workspaceHref} onClick={onNavigate} className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{workspaceLabel}</Link> : null}{secondaryWorkspaceHref && secondaryWorkspaceLabel ? <Link href={secondaryWorkspaceHref} onClick={onNavigate} className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{secondaryWorkspaceLabel}</Link> : null}<Link href={profileHref} onClick={onNavigate} className="inline-flex min-h-10 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{common("accountSettings")}</Link><form action={routes.auth.signout()} method="post"><button type="submit" className={cn("inline-flex min-h-10 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", stacked && "w-full")}>{common("signOut")}</button></form><LocaleSwitcher /></div>;
}
