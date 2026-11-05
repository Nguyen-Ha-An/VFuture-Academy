import { useSyncExternalStore, type ReactNode } from 'react';

const listen = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
};
const snapshot = () => `${location.pathname}${location.search}${location.hash}`;

export function usePathname() { return useSyncExternalStore(listen, () => location.pathname, () => '/studio/courses/minimal'); }
export function useSearchParams() { return new URLSearchParams(useSyncExternalStore(listen, () => location.search, () => '')); }
const router = {
  push(href: string) { history.pushState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); },
  replace(href: string) { history.replaceState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); },
  back() { history.back(); }, forward() { history.forward(); }, refresh() {}, prefetch: async () => {},
};
export function useRouter() { return router; }
// Vite has no Next server-inserted-HTML context; the real Next harness uses the actual hook.
export function useServerInsertedHTML(_callback: () => ReactNode) { return undefined; }
export function useSelectedLayoutSegments() { return useSyncExternalStore(listen, () => snapshot().split('?')[0].split('/').filter(Boolean), () => []); }
