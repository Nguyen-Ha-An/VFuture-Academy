'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { DrawerLayout } from '@instructure/ui-drawer-layout/v11_7';
import { CanvasButton } from './controls';

/** Server-rendered course content stays on the server; only navigation disclosure is interactive. */
export function CanvasCourseLayout({ navigation, children, navigationLabel }: { navigation: ReactNode; children: ReactNode; navigationLabel?: string }) {
  const vi = useLocale() === 'vi';
  const label = navigationLabel ?? (vi ? 'Điều hướng khóa học' : 'Course navigation');
  const id = useId();
  const [wide, setWide] = useState(true);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const returnFocus = useRef(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const navigationRef = useRef<HTMLDivElement | null>(null);
  const closeNavigation = useCallback((restoreFocus: boolean) => {
    if (!openRef.current) return;
    openRef.current = false;
    returnFocus.current = restoreFocus;
    setOpen(false);
  }, []);
  useLayoutEffect(() => {
    if (wide || !open) return;
    const ownerDocument = triggerRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    if (!ownerDocument || !ownerWindow) return;
    let listening = true;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (!openRef.current || event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target instanceof ownerWindow.Element ? event.target : ownerDocument.activeElement;
      if (!target) return;
      // Preserve ownership before nested controls handle the event and collapse.
      if (target.closest('[role="listbox"], [role="menu"], [aria-expanded="true"][role="combobox"], [aria-expanded="true"][aria-haspopup], input[type="file"]')) return;
      const ownDialog = navigationRef.current?.closest('[role="dialog"], [role="alertdialog"]');
      const targetDialog = target.closest('[role="dialog"], [role="alertdialog"]');
      if (targetDialog && targetDialog !== ownDialog) return;
      if (target === ownerDocument.body && [...ownerDocument.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some(dialog => dialog !== ownDialog && !dialog.closest('[hidden], [inert], [aria-hidden="true"]') && dialog.getClientRects().length > 0)) return;
      // Capture sees Escape even while native enter-focus temporarily targets body.
      // Decide after dispatch so a nested handler can still prevent its default.
      ownerWindow.queueMicrotask(() => {
        if (listening && !event.defaultPrevented && openRef.current) closeNavigation(true);
      });
    };
    ownerWindow.addEventListener('keydown', handleEscape, true);
    return () => { listening = false; ownerWindow.removeEventListener('keydown', handleEscape, true); };
  }, [wide, open, closeNavigation]);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => { openRef.current = false; returnFocus.current = false; setWide(media.matches); setOpen(false); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  // InstUI 11.7 DrawerTray always autofocuses its internal Dialog and does not
  // expose shouldFocusOnOpen. Permanent desktop navigation therefore stays outside
  // that focus region; the Content subtree remains mounted across breakpoints.
  return <div className="canvas-course-layout" data-wide={wide || undefined}>
    {wide && <div className="canvas-course-navigation">{navigation}</div>}
    <div className="canvas-course-drawer">
      {!wide && <div className="canvas-course-navigation-toggle"><CanvasButton ref={triggerRef} variant="outline" aria-expanded={open} aria-controls={id} onClick={() => { if (openRef.current) closeNavigation(true); else { returnFocus.current = false; openRef.current = true; setOpen(true); } }}>{label}</CanvasButton></div>}
      <DrawerLayout minWidth="40rem">
        <DrawerLayout.Tray id={id} label={label} open={!wide && open} placement="start" onDismiss={() => closeNavigation(true)} shouldContainFocus={!wide} shouldReturnFocus={false} shouldCloseOnEscape={false} shouldCloseOnDocumentClick onExited={() => {
          if (returnFocus.current && !openRef.current && !wide && triggerRef.current?.isConnected) triggerRef.current.focus();
          returnFocus.current = false;
        }}>
          <div ref={navigationRef} className="canvas-course-navigation" onClick={event => { if ((event.target as Element).closest('a[href]')) closeNavigation(false); }}><CanvasButton variant="ghost" onClick={() => closeNavigation(true)}>{vi ? 'Đóng' : 'Close'}</CanvasButton>{navigation}</div>
        </DrawerLayout.Tray>
        <DrawerLayout.Content themeOverride={{ overflowY: 'visible' }} label={vi ? 'Nội dung khóa học' : 'Course content'}><div className="canvas-course-content">{children}</div></DrawerLayout.Content>
      </DrawerLayout>
    </div>
  </div>;
}
