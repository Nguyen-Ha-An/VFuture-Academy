'use client';

import { useRouter } from 'next/navigation';
import { type AnchorHTMLAttributes, type MouseEvent, type Ref } from 'react';

import { requestNavigation } from '@/lib/navigation-guard';

type LearnerNavigationLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string;
  ref?: Ref<HTMLAnchorElement>;
  onNavigationStart?: () => void;
  onNavigationAccepted?: () => void;
  onNavigationCancelled?: () => void;
};

// The first destination owns the shared decision, including across different links.
let navigationPending = false;

function shouldGuardNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  const anchor = event.currentTarget;
  const destination = new URL(anchor.href, window.location.href);
  return event.button === 0
    && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
    && !event.defaultPrevented
    && (!anchor.target || anchor.target === '_self')
    && !anchor.hasAttribute('download')
    && destination.origin === window.location.origin
    && (destination.protocol === 'http:' || destination.protocol === 'https:');
}

export function LearnerNavigationLink({ href, onClick, onNavigationStart, onNavigationAccepted, onNavigationCancelled, ...props }: LearnerNavigationLinkProps) {
  const router = useRouter();
  const handleClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!shouldGuardNavigation(event)) return;
    event.preventDefault();
    const source = event.currentTarget;
    if (navigationPending) return;
    navigationPending = true;
    try {
      onNavigationStart?.();
      if (await requestNavigation()) {
        onNavigationAccepted?.();
        router.push(href);
      } else {
        if (onNavigationCancelled) onNavigationCancelled();
        else if (source.isConnected) source.focus();
      }
    } finally {
      navigationPending = false;
    }
  };
  return <a href={href} {...props} onClick={handleClick} />;
}
