'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { PublicLink } from './PublicNavigation';

/** A duplicate action appears only while the original and lower-page chrome are offscreen. */
export function PublicStickyAction({ targetId, href, children }: { targetId: string; href: string; children: ReactNode }) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target || typeof IntersectionObserver === 'undefined') return;
    let targetVisible = true;
    let footerVisible = false;
    const update = () => {
      const active = document.activeElement;
      const editing = active instanceof HTMLElement && (active.matches('input, textarea, select') || active.isContentEditable);
      const viewport = window.visualViewport;
      const keyboard = editing || Boolean(viewport && window.innerHeight - viewport.height > 150);
      const consent = Boolean(document.querySelector('[data-consent-open="true"]'));
      setVisible(!targetVisible && !footerVisible && !keyboard && !consent);
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === target) targetVisible = entry.isIntersecting;
        else footerVisible = entry.isIntersecting;
      }
      update();
    }, { threshold: 0, rootMargin: '-76px 0px 0px 0px' });
    observer.observe(target);
    const footer = document.querySelector('[data-public-footer]');
    if (footer) observer.observe(footer);
    // Consent can render in a portal outside the public layout.
    const consentObserver = new MutationObserver(update);
    consentObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-consent-open'] });
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      consentObserver.disconnect();
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, [targetId, pathname]);
  return <div ref={element} className="public-sticky-action" data-visible={visible}>
    <PublicLink href={href} className="public-button" tabIndex={visible ? undefined : -1}>{children}</PublicLink>
  </div>;
}
