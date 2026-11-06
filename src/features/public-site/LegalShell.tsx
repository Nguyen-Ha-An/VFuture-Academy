import type { ReactNode } from 'react';
import { CookieConsent } from './ConsentPanel';
import { PublicNavigationProvider } from './PublicNavigation';

/** Legal notices retain their styles and working privacy controls without marketing navigation. */
export function LegalShell({ children }: { children: ReactNode }) {
  return <div className="academy-shell-site public-site"><PublicNavigationProvider>{children}<CookieConsent /></PublicNavigationProvider></div>;
}
