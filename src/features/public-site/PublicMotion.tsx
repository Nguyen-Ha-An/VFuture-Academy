'use client';

import { lazy, Suspense, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useDesktopMotion } from './useDesktopMotion';

const DesktopEffects = lazy(() => import('./PublicMotionEffects').then((module) => ({ default: module.PublicMotionEffects })));

export function PublicMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const enabled = useDesktopMotion() || pathname !== '/';

  return <div ref={root} className="public-motion">
    {children}
    {enabled && <Suspense fallback={null}><DesktopEffects scopeRef={root} /></Suspense>}
  </div>;
}
