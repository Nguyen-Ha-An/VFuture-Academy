'use client';

import Link from 'next/link';
import { SideNavBar } from '@instructure/ui-side-nav-bar/v11_7';
import { useLocale } from 'next-intl';
import { usePathname } from 'next/navigation';
import { BookOpen, CalendarDays, Compass, GraduationCap, LayoutDashboard, Settings, UserRound, PencilRuler, type LucideIcon } from 'lucide-react';
import { BrandMark } from '@/features/workspace-ui/ui/primitives';

type Destination = { key: string; href: string; label: string; icon: LucideIcon };

/** Workspace entry links use server-resolved admission destinations. The rail grants no access. */
export function GlobalNavigation({ studio, grading, admin, mobile = false, onNavigate, label }: { studio?: string | null; grading?: string | null; admin?: string | null; mobile?: boolean; onNavigate?: () => void; label?: string }) {
  const vi = useLocale() === 'vi';
  const pathname = usePathname();
  const items: Destination[] = [
    { key: 'dashboard', href: '/app', label: vi ? 'Tổng quan' : 'Dashboard', icon: LayoutDashboard },
    { key: 'courses', href: '/app/courses', label: vi ? 'Khóa học' : 'Courses', icon: BookOpen },
    { key: 'calendar', href: '/app/calendar', label: vi ? 'Lịch' : 'Calendar', icon: CalendarDays },
    { key: 'explore', href: '/app/explore', label: vi ? 'Khám phá' : 'Explore', icon: Compass },
    ...(studio ? [{ key: 'studio', href: studio, label: 'Studio', icon: PencilRuler }] : []),
    ...(grading ? [{ key: 'grading', href: grading, label: vi ? 'Giảng dạy' : 'Teaching', icon: GraduationCap }] : []),
    ...(admin ? [{ key: 'admin', href: admin, label: vi ? 'Quản trị' : 'Admin', icon: Settings }] : []),
    { key: 'profile', href: '/app/profile', label: vi ? 'Tài khoản' : 'Account', icon: UserRound },
  ];
  const active = (item: Destination) => item.key === 'explore' ? /^\/app\/(explore|resources|opportunities|projects)(?:\/|$)/.test(pathname) : item.key === 'profile' ? /^\/app\/(profile|leaderboard)(?:\/|$)/.test(pathname) : item.href === '/app' ? ['/app', '/app/tasks', '/app/results'].includes(pathname) : item.key === 'studio' || item.key === 'grading' || item.key === 'admin' ? pathname.startsWith(`/${item.key}`) : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return <div className={mobile ? 'canvas-global-nav canvas-global-nav-mobile' : 'canvas-global-nav'}>
    <SideNavBar label={label ?? (vi ? 'Điều hướng toàn cục' : 'Global navigation')} toggleLabel={{ expandedLabel: vi ? 'Thu gọn nhãn điều hướng' : 'Collapse navigation labels', minimizedLabel: vi ? 'Hiện nhãn điều hướng' : 'Show navigation labels' }} themeOverride={{ width: mobile ? '100%' : '84px', minimizedWidth: mobile ? '100%' : '84px', margin: '0', minimizedMargin: '0', contentMargin: '0', contentGap: '0', borderRadius: '0', minimizedBorderRadius: '0', backgroundColor: '#064d53', fontColor: '#fff' }}>
      <SideNavBar.Item as={Link} href="/app" className="canvas-global-brand" icon={<BrandMark className="canvas-brand-symbol" />} label="VFuture" onClick={onNavigate} />
      {items.map(item => <SideNavBar.Item key={item.key} as={Link} href={item.href} onClick={onNavigate} selected={active(item)} aria-current={active(item) ? 'page' : undefined} icon={<item.icon aria-hidden="true" />} label={item.label} themeOverride={{ borderRadius: '0', fontSize: '11px', contentPadding: '9px 5px', fontColor: '#fff', hoverBackgroundColor: '#09616a', selectedBackgroundColor: '#fff', selectedFontColor: '#075961', innerFocusOutlineColor: '#f4d78a' }} />)}
    </SideNavBar>
  </div>;
}
