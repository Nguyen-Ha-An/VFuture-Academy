import { useSyncExternalStore } from 'react';
const subscribe = (notify: () => void) => { window.addEventListener('popstate', notify); window.addEventListener('hashchange', notify); return () => { window.removeEventListener('popstate', notify); window.removeEventListener('hashchange', notify); }; };
export function usePathname() { return useSyncExternalStore(subscribe, () => location.pathname, () => '/app'); }
export function useSearchParams() { return new URLSearchParams(useSyncExternalStore(subscribe, () => location.search, () => '')); }
export function notFound(): never { throw new Error('fixture not found'); }
export function redirect(href: string): never { history.replaceState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); throw new Error('fixture redirect'); }
export function useRouter() { return { push(href: string) { history.pushState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }, replace(href: string) { history.replaceState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }, refresh() {}, back() { history.back(); }, forward() { history.forward(); }, prefetch: async () => {} }; }

export function unstable_rethrow() {}
