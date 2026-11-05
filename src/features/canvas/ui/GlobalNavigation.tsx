'use client';

import Link from 'next/link';
import { useState, type SyntheticEvent } from 'react';
import { Link as NativeLink } from '@instructure/ui-link/v11_7';
import { Button as NativeButton } from '@instructure/ui-buttons/v11_7';
import { SideNavBar } from '@instructure/ui-side-nav-bar/v11_7';
import { useLocale } from 'next-intl';
import { usePathname } from 'next/navigation';
import { BookOpen, CalendarDays, Compass, GraduationCap, LayoutDashboard, Settings, UserRound, PencilRuler, type LucideIcon } from 'lucide-react';
import { BrandMark } from '@/features/workspace-ui/ui/primitives';

type Destination = { key: string; href: string; label: string; icon: LucideIcon };

/** Workspace entry links use server-resolved admission destinations. The rail grants no access. */
export function GlobalNavigation({ studio, grading, admin, mobile = false, onNavigate, onNavigateRequest, label, onAccount, accountOpen = false, accountControls }: { studio?: string | null; grading?: string | null; admin?: string | null; mobile?: boolean; onNavigate?: () => void; onNavigateRequest?: (event: SyntheticEvent<unknown>, href: string) => void; label?: string; onAccount?: (event: SyntheticEvent<unknown>) => void; accountOpen?: boolean; accountControls?: string }) {
  const vi = useLocale() === 'vi';
  const [minimized, setMinimized] = useState(false);
  const pathname = usePathname();
  const accountRoute = /^\/app\/(profile|leaderboard)(?:\/|$)/.test(pathname);
  const items: Destination[] = [
    { key: 'dashboard', href: '/app', label: vi ? 'Tổng quan' : 'Dashboard', icon: LayoutDashboard },
    { key: 'courses', href: '/app/courses', label: vi ? 'Khóa học' : 'Courses', icon: BookOpen },
    { key: 'calendar', href: '/app/calendar', label: vi ? 'Lịch' : 'Calendar', icon: CalendarDays },
    { key: 'explore', href: '/app/explore', label: vi ? 'Khám phá' : 'Explore', icon: Compass },
    ...(studio ? [{ key: 'studio', href: studio, label: 'Studio', icon: PencilRuler }] : []),
    ...(grading ? [{ key: 'grading', href: grading, label: vi ? 'Giảng dạy' : 'Teaching', icon: GraduationCap }] : []),
    ...(admin ? [{ key: 'admin', href: admin, label: vi ? 'Quản trị' : 'Admin', icon: Settings }] : []),
    ...(!onAccount ? [{ key: 'profile', href: '/app/profile', label: vi ? 'Tài khoản' : 'Account', icon: UserRound }] : []),
  ];
  const active = (item: Destination) => item.key === 'explore' ? /^\/app\/(explore|resources|opportunities|projects)(?:\/|$)/.test(pathname) : item.key === 'profile' ? /^\/app\/(profile|leaderboard)(?:\/|$)/.test(pathname) : item.href === '/app' ? ['/app', '/app/tasks', '/app/results'].includes(pathname) : item.key === 'studio' || item.key === 'grading' || item.key === 'admin' ? pathname.startsWith(`/${item.key}`) : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const navigationLabel = label ?? (vi ? 'Điều hướng toàn cục' : 'Global navigation');
  const accountLabel = vi ? 'Tài khoản' : 'Account';
  if (mobile) return <nav className="canvas-global-nav canvas-global-nav-mobile" aria-label={navigationLabel}>
    <ul>{items.map(item => <li key={item.key}><NativeLink forceButtonRole={false} as={Link} href={item.href} data-academy-managed-navigation={onNavigateRequest ? 'true' : undefined} onClick={event => onNavigateRequest ? onNavigateRequest(event, item.href) : onNavigate?.()} aria-current={active(item) ? 'page' : undefined} color="link" size="small" display="flex" renderIcon={<item.icon aria-hidden="true" />}>{item.label}</NativeLink></li>)}
      {onAccount && <li><NativeButton type="button" className="canvas-account-trigger" onClick={onAccount} aria-haspopup="dialog" aria-expanded={accountOpen} aria-controls={accountControls} aria-current={accountRoute ? 'page' : undefined} color="secondary" withBackground={accountOpen || accountRoute} size="small" display="block" textAlign="start" renderIcon={<UserRound aria-hidden="true" />}>{accountLabel}</NativeButton></li>}
    </ul>
  </nav>;
  // Native 11.7.10 owns its minimized state: its controlled prop does not update
  // child labels. Mirror the supported callback into the layout token, without remounting.
  return <div className="canvas-global-nav" data-minimized={minimized ? 'true' : 'false'}>
    <SideNavBar defaultMinimized={false} onMinimized={(_event, value) => setMinimized(value)} label={navigationLabel} toggleLabel={{ expandedLabel: vi ? 'Thu gọn điều hướng' : 'Collapse navigation', minimizedLabel: vi ? 'Mở rộng điều hướng' : 'Expand navigation' }} themeOverride={{ width: '84px', minimizedWidth: '56px', margin: '0', minimizedMargin: '0', contentMargin: '0', contentGap: '0', borderRadius: '0', minimizedBorderRadius: '0', backgroundColor: '#064d53', fontColor: '#fff' }}>
      <SideNavBar.Item as={Link} href="/app" className="canvas-global-brand" icon={<BrandMark className="canvas-brand-symbol" />} label="VFuture" onClick={onNavigate} />
      {items.map(item => <SideNavBar.Item key={item.key} as={Link} href={item.href} onClick={onNavigate} selected={active(item)} aria-current={active(item) ? 'page' : undefined} icon={<item.icon aria-hidden="true" />} label={item.label} themeOverride={{ borderRadius: '0', fontSize: '11px', contentPadding: '9px 5px', fontColor: '#fff', hoverBackgroundColor: '#09616a', selectedBackgroundColor: '#fff', selectedFontColor: '#075961', innerFocusOutlineColor: '#f4d78a' }} />)}
      {onAccount && <SideNavBar.Item as="button" type="button" className="canvas-account-trigger" onClick={onAccount} aria-haspopup="dialog" aria-expanded={accountOpen} aria-controls={accountControls} aria-current={accountRoute ? 'page' : undefined} selected={accountOpen || accountRoute} icon={<UserRound aria-hidden="true" />} label={accountLabel} themeOverride={{ borderRadius: '0', fontSize: '11px', contentPadding: '9px 5px', fontColor: '#fff', hoverBackgroundColor: '#09616a', selectedBackgroundColor: '#fff', selectedFontColor: '#075961', innerFocusOutlineColor: '#f4d78a' }} />}
    </SideNavBar>
  </div>;
}
