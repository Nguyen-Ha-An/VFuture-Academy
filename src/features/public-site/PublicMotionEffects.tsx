'use client';

import { type RefObject } from 'react';
import { usePathname } from 'next/navigation';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

/** Only tagged public content moves. Everything starts readable, and query updates never replay entrances. */
export function PublicMotionEffects({ scopeRef }: { scopeRef: RefObject<HTMLDivElement | null> }) {
  const pathname = usePathname();
  useGSAP(() => {
    if (!scopeRef.current) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const root = scopeRef.current;
      if (!root) return;
      const titles = root.querySelectorAll<HTMLElement>('[data-public-header] .public-title, [data-public-header].public-title');
      if (titles.length) gsap.from(titles, { y: 20, duration: .65, ease: 'power3.out', clearProps: 'transform' });
      root.querySelectorAll<HTMLElement>('[data-public-reveal]').forEach((element) => {
        gsap.from(element, { y: 18, duration: .55, ease: 'power3.out', clearProps: 'transform',
          ...(element.closest('[data-public-results]') ? {} : { scrollTrigger: { trigger: element, start: 'top 96%', once: true } }),
        });
      });
      root.querySelectorAll<HTMLElement>('[data-public-rule]').forEach((element) => {
        gsap.from(element, { scaleX: .85, transformOrigin: 'left center', duration: .8, ease: 'power3.out', clearProps: 'transform,transformOrigin', scrollTrigger: { trigger: element, start: 'top 96%', once: true } });
      });
    });
    return () => media.revert();
  }, { scope: scopeRef, dependencies: [pathname], revertOnUpdate: true });
  return null;
}
