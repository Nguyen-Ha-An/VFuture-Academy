'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { Tray } from '@instructure/ui-tray/v11_7';
import { X } from 'lucide-react';
import { CanvasButton, CanvasLink } from './controls';
import { schoolTargetHref } from '@/features/admin/school-navigation';
import { requestNavigation } from '@/lib/navigation-guard';
import './courses-tray.css';

export const COURSES_TRAY_ID = 'academy-courses-tray';
type Course = { id: string; title: string; branchId?: string; branchName?: string };
type Group = { courses: Course[]; error: boolean; loading: boolean };
const initial: Group = { courses: [], error: false, loading: true };
function subscribe(notify: () => void) { if (typeof window.matchMedia !== 'function') return () => {}; const q = window.matchMedia('(max-width: 767px)'); q.addEventListener('change', notify); return () => q.removeEventListener('change', notify); }
function phoneLayout() { return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches; }

export function CoursesTray({ open, onOpenChange, restoreFocus }: { open: boolean; onOpenChange: (open: boolean) => void; restoreFocus: () => void }) {
  const vi = useLocale() === 'vi';
  const locale = vi ? 'vi' : 'en';
  const router = useRouter();
  const pathname = usePathname();
  const phone = useSyncExternalStore(subscribe, phoneLayout, () => false);
  const mount = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLElement>(null);
  const pending = useRef<string | null>(null);
  const frame = useRef<number | null>(null);
  const exitObserver = useRef<MutationObserver | null>(null);
  const previousOpen = useRef(open);
  const latestOpen = useRef(open); latestOpen.current = open;
  const generation = useRef(0);
  const previousPath = useRef(pathname);
  const routeClose = useRef(false);
  const [enrolled, setEnrolled] = useState<Group>(initial);
  const [teaching, setTeaching] = useState<Group>(initial);
  useEffect(() => () => { generation.current++; if (frame.current !== null) cancelAnimationFrame(frame.current); exitObserver.current?.disconnect(); }, []);
  useEffect(() => {
    if (previousPath.current !== pathname) {
      previousPath.current = pathname;
      routeClose.current = routeClose.current || latestOpen.current || previousOpen.current || exitObserver.current !== null || frame.current !== null;
      generation.current++; pending.current = null;
      exitObserver.current?.disconnect(); exitObserver.current = null;
      if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    }
    onOpenChange(false);
  }, [pathname, onOpenChange]);
  useEffect(() => {
    if (!open) return;
    if (!previousOpen.current) routeClose.current = false;
    exitObserver.current?.disconnect(); exitObserver.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    generation.current++; pending.current = null;
    const controller = new AbortController();
    setEnrolled(initial); setTeaching(initial);
    const load = async (url: string, kind: 'enrolled' | 'teaching', set: (group: Group) => void) => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (kind === 'teaching' && (response.status === 403 || response.status === 401)) { if (!controller.signal.aborted) set({ courses: [], error: false, loading: false }); return; }
        if (!response.ok) throw new Error('Course list unavailable');
        const json = await response.json();
        const rows = json.data?.courses;
        if (!Array.isArray(rows)) throw new Error('Invalid course list');
        const courses: Course[] = rows.flatMap((row: Record<string, unknown>) => {
          const id = kind === 'enrolled' ? row.id : row.courseId;
          if (typeof id !== 'string' || typeof row.title !== 'string' || (kind === 'teaching' && typeof row.branchId !== 'string')) return [];
          return [{ id, title: row.title, branchId: typeof row.branchId === 'string' ? row.branchId : undefined, branchName: typeof row.branchName === 'string' ? row.branchName : undefined }];
        });
        if (!controller.signal.aborted) set({ courses, error: false, loading: false });
      } catch { if (!controller.signal.aborted) set({ courses: [], error: true, loading: false }); }
    };
    void load(`/api/v1/learning/courses?locale=${locale}`, 'enrolled', setEnrolled);
    void load(`/api/v1/teaching/assigned-courses?locale=${locale}`, 'teaching', setTeaching);
    return () => controller.abort();
  }, [open, locale]);
  const dismiss = () => { pending.current = null; onOpenChange(false); };
  const navigate = (event: SyntheticEvent<unknown>, href: string) => {
    if (('button' in event && event.button !== 0) || ('metaKey' in event && event.metaKey) || ('ctrlKey' in event && event.ctrlKey) || ('shiftKey' in event && event.shiftKey) || ('altKey' in event && event.altKey)) return;
    event.preventDefault(); pending.current = href; onOpenChange(false);
  };
  const finishExit = useCallback(() => {
    const current = generation.current;
    const afterDialogRemoval = () => {
      if (latestOpen.current || current !== generation.current) { exitObserver.current?.disconnect(); exitObserver.current = null; return; }
      if (mount.current?.querySelector(`#${COURSES_TRAY_ID}`)) return;
      exitObserver.current?.disconnect(); exitObserver.current = null;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (latestOpen.current || current !== generation.current) return;
        if (routeClose.current) {
          routeClose.current = false; pending.current = null;
          const headings = document.querySelectorAll<HTMLElement>('main h1[tabindex="-1"], main[tabindex="-1"]');
          [...headings].find(element => element.isConnected && !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length > 0)?.focus({ preventScroll: true });
          return;
        }
        const href = pending.current; pending.current = null;
        if (!href) { restoreFocus(); return; }
        const destination = new URL(href, window.location.href);
        const same = destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash === window.location.hash;
        void (same ? Promise.resolve(true) : requestNavigation()).then(allowed => {
          if (latestOpen.current || current !== generation.current) return;
          if (!allowed) { restoreFocus(); return; }
          if (same) document.querySelector<HTMLElement>('#learner-main h1, #learner-main')?.focus({ preventScroll: true });
          else router.push(href);
        });
      });
    };
    // Changing placement during a native slide can interrupt onExited and leave an
    // empty portal wrapper. Wait for owned dialog content and its focus region to unmount.
    exitObserver.current?.disconnect();
    if (mount.current?.querySelector(`#${COURSES_TRAY_ID}`)) {
      exitObserver.current = new MutationObserver(afterDialogRemoval);
      exitObserver.current.observe(mount.current, { childList: true, subtree: true });
    }
    afterDialogRemoval();
  }, [restoreFocus, router]);
  useEffect(() => {
    const wasOpen = previousOpen.current;
    previousOpen.current = open;
    if (!open && (wasOpen || routeClose.current)) finishExit();
  }, [open, pathname, finishExit]);
  const group = (title: string, data: Group, teachingGroup = false) => <section><h3>{title}</h3>{data.loading ? <p role="status">{vi ? 'Đang tải…' : 'Loading…'}</p> : data.error ? <p role="status">{vi ? 'Không thể tải danh sách.' : 'Could not load courses.'}</p> : data.courses.length ? <ul>{data.courses.map(course => { const href = teachingGroup ? schoolTargetHref({ target: 'teaching', courseId: course.id, branchId: course.branchId! }) : `/app/courses/${encodeURIComponent(course.id)}`; return <li key={`${course.id}:${course.branchId ?? ''}`}><CanvasLink href={href} data-academy-managed-navigation="true" onClick={event => navigate(event, href)}>{course.title}{teachingGroup && course.branchName ? ` — ${course.branchName}` : ''}</CanvasLink></li>; })}</ul> : <p>{vi ? 'Chưa có khóa học.' : 'No courses yet.'}</p>}</section>;
  return <><div ref={mount} className="canvas-courses-mount" data-open={open || undefined} /><Tray label={vi ? 'Khóa học' : 'Courses'} mountNode={() => mount.current} open={open} placement={phone ? 'bottom' : 'start'} size="small" themeOverride={{ widthSm: '370px', padding: '0' }} defaultFocusElement={() => close.current} shouldContainFocus shouldReturnFocus={false} shouldCloseOnDocumentClick onDismiss={dismiss} border={false}>
    <div id={COURSES_TRAY_ID} className="canvas-courses-panel"><header className="canvas-courses-heading"><CanvasButton ref={close} variant="ghost" size="icon" aria-label={vi ? 'Đóng' : 'Close'} onClick={dismiss}><X size={21} aria-hidden="true" /></CanvasButton><h2>{vi ? 'Khóa học' : 'Courses'}</h2></header><div className="canvas-courses-scroll"><CanvasLink href="/app/courses" data-academy-managed-navigation="true" onClick={event => navigate(event, '/app/courses')}>{vi ? 'Tất cả khóa học' : 'All courses'}</CanvasLink>{group(vi ? 'Đang học' : 'Enrolled courses', enrolled)}{(teaching.loading || teaching.error || teaching.courses.length > 0) && group(vi ? 'Giảng dạy' : 'Teaching courses', teaching, true)}</div></div>
  </Tray></>;
}
