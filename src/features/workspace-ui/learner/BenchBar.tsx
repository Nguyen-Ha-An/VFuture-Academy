'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { modalHasFocus } from '@/components/command-shortcut';
import { isNavigationItemActive } from '@/components/ShellPrimitives';
import { requestNavigation } from '@/lib/navigation-guard';
import { BrandMark } from '../ui/primitives';

export type BenchNavItem = { key: string; href: string; label: string; code: string };

const SHORTCUT_WINDOW_MS = 1500;

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  return target.matches('input, textarea, select, [role="textbox"], [role="combobox"]');
}

/**
 * `g` then `1`/`2`/`3` jumps between the section codes (spec section 8). Ignored while
 * typing, while a modal has focus, with modifiers held, or once the prefix has timed out.
 * The listener reads the latest items and navigate from a ref, so a re-render between `g` and
 * the digit never drops the pending prefix.
 */
export function useSectionShortcuts(items: BenchNavItem[], navigate: (href: string) => void, enabled = true) {
  const latest = useRef({ items, navigate });
  useEffect(() => {
    latest.current = { items, navigate };
  });
  useEffect(() => {
    if (!enabled) return;
    let armedAt = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target) || modalHasFocus()) { armedAt = 0; return; }
      const key = event.key.toLowerCase();
      if (armedAt && Date.now() - armedAt <= SHORTCUT_WINDOW_MS && /^[1-9]$/.test(key)) {
        armedAt = 0;
        const item = latest.current.items[Number(key) - 1];
        if (item) { event.preventDefault(); latest.current.navigate(item.href); }
        return;
      }
      armedAt = key === 'g' && !event.shiftKey ? Date.now() : 0;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

export function BenchNavLinks({ items, pathname, onNavigate }: { items: BenchNavItem[]; pathname: string; onNavigate?: () => void }) {
  return <ul>{items.map(item => {
    const active = isNavigationItemActive(pathname, item.href);
    return <li key={item.key}><Link href={item.href} aria-current={active ? 'page' : undefined} onClick={onNavigate}><span className="vf-code" aria-hidden="true">{item.code}</span>{item.label}</Link></li>;
  })}</ul>;
}

/** The 56px learner bench bar: brand, section-coded nav, then search (⌘K), account area and the phone menu button. */
export function BenchBar({ items, pathname, navigationLabel, brandHref, brandLabel, search, account, menuButton, shortcuts = true }: { items: BenchNavItem[]; pathname: string; navigationLabel: string; brandHref: string; brandLabel: string; search?: ReactNode; account: ReactNode; menuButton: ReactNode; shortcuts?: boolean }) {
  const t = useTranslations('bench.learner.shell');
  const router = useRouter();
  // The unsaved-changes guard only intercepts link clicks and form submits, so the shortcuts ask it
  // explicitly, like the command menu does, before pushing.
  const navigate = useCallback((href: string) => {
    void requestNavigation().then((allowed) => { if (allowed) router.push(href); });
  }, [router]);
  useSectionShortcuts(items, navigate, shortcuts);
  return <header className="vf-bench">
    <div className="vf-bench-row">
      <Link href={brandHref} className="vf-brand" aria-label={brandLabel}><BrandMark /><span>{t('brand')}</span></Link>
      <nav aria-label={navigationLabel} className="vf-bench-nav"><BenchNavLinks items={items} pathname={pathname} /></nav>
      <div className="vf-bench-right">
        {search}
        <div className="vf-bench-account min-w-0 items-center">{account}</div>
        {menuButton}
      </div>
    </div>
  </header>;
}
