'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ComponentProps, type FormHTMLAttributes, type ReactNode } from 'react';
import { track } from '@/lib/analytics-client';
import { isPublicPath, publicHref, publicRouteKey, type PublicLocale } from './public-navigation';
import { publicCopy } from './public-copy';

type ResultNavigation = { prepare: (href: string) => void; navigate: (href: string, options?: { replace?: boolean; scroll?: boolean }) => void; pending: boolean };
const NavigationContext = createContext<ResultNavigation | null>(null);

function locationKey(href: string): string {
  const url = new URL(href, window.location.href);
  url.searchParams.sort();
  return `${url.pathname}?${url.searchParams}`;
}

function revealResults(): string {
  const summary = document.querySelector<HTMLElement>('[data-public-results-focus]');
  if (!summary) return '';
  summary.focus({ preventScroll: true });
  const bounds = summary.getBoundingClientRect();
  if (bounds.top < 100 || bounds.bottom > window.innerHeight) summary.scrollIntoView({ block: 'start', behavior: 'instant' });
  return summary.textContent?.trim() ?? '';
}

/** Owns focus only for explicit result navigation, leaving browser history restoration alone. */
export function PublicNavigationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const query = search.toString();
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const intention = useRef<string | null>(null);
  const previousLocation = useRef<string | null>(null);
  const lastView = useRef<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const frame = useRef<number | null>(null);
  const announceResults = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { setAnnouncement(revealResults()); frame.current = null; });
  }, []);
  const prepare = useCallback((href: string) => {
    intention.current = locationKey(href);
    setAnnouncement('');
    if (intention.current === locationKey(window.location.href)) {
      intention.current = null;
      announceResults();
    }
  }, [announceResults]);
  const navigate = useCallback((href: string, options?: { replace?: boolean; scroll?: boolean }) => {
    prepare(href);
    startTransition(() => {
      if (options?.replace) router.replace(href, { scroll: options.scroll ?? false });
      else router.push(href, { scroll: options?.scroll ?? false });
    });
  }, [prepare, router]);

  useEffect(() => {
    const clearIntention = () => {
      intention.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      setAnnouncement('');
    };
    window.addEventListener('popstate', clearIntention);
    return () => { window.removeEventListener('popstate', clearIntention); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);

  useEffect(() => {
    if (pending) return;
    const committed = locationKey(`${pathname}?${query}`);
    if (committed === previousLocation.current) return;
    previousLocation.current = committed;
    if (intention.current === committed) {
      intention.current = null;
      announceResults();
    } else {
      intention.current = null;
      setAnnouncement('');
    }
  }, [pathname, query, pending, announceResults]);

  useEffect(() => {
    const route = publicRouteKey(pathname);
    const view = `${pathname}:${locale}`;
    if (route && lastView.current !== view) {
      lastView.current = view;
      track('public.page_viewed', { route, locale });
    }
  }, [pathname, locale]);

  return <NavigationContext.Provider value={{ prepare, navigate, pending }}>
    {children}
    <span className="public-sr-only" role="status" aria-live="polite" aria-atomic="true">{pending ? publicCopy[locale].loadingResults : announcement}</span>
  </NavigationContext.Provider>;
}

/** Keeps previous results usable while loading and gives committed queries a brief, readable arrival. */
export function PublicResults({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const navigation = useContext(NavigationContext);
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const region = useRef<HTMLElement>(null);
  const previous = useRef({ pathname, query });
  useEffect(() => {
    const changedQuery = previous.current.pathname === pathname && previous.current.query !== query;
    previous.current = { pathname, query };
    if (!changedQuery || !region.current?.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const arrival = region.current.animate([{ transform: 'translateY(6px)' }, { transform: 'none' }], {
      duration: 200, easing: 'cubic-bezier(.22, 1, .36, 1)',
    });
    return () => arrival.cancel();
  }, [pathname, query]);
  return <section ref={region} id="public-results" className="public-results" data-public-results aria-labelledby="public-results-summary" aria-busy={navigation?.pending || undefined}>
    <div className="public-results__progress" aria-hidden="true" />
    <div id="public-results-summary" className="public-results__summary public-meta" tabIndex={-1} data-public-results-focus>{summary}</div>
    {children}
  </section>;
}

type PublicLinkProps = ComponentProps<typeof Link> & {
  resultNavigation?: boolean;
  analytics?: { name: string; props: Record<string, string | number | boolean | null> };
};

export function PublicLink({ href, resultNavigation = false, analytics, onClick, scroll, ...props }: PublicLinkProps) {
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const navigation = useContext(NavigationContext);
  let destination = href;
  if (typeof href === 'string') {
    const explicitLocale = href.startsWith('/') && !href.startsWith('//') ? new URL(href, 'https://public.invalid').searchParams.get('lang') : null;
    destination = publicHref(href, explicitLocale === 'vi' || explicitLocale === 'en' ? explicitLocale : locale);
  } else if (href.pathname && !href.host && !href.hostname && !href.protocol && isPublicPath(href.pathname)) {
    const query = href.query && typeof href.query === 'object' ? href.query : Object.fromEntries(new URLSearchParams(href.query ?? ''));
    destination = { ...href, query: { ...query, lang: query.lang === 'en' || query.lang === 'vi' ? query.lang : locale } };
  }
  return <Link {...props} href={destination} scroll={scroll ?? (resultNavigation ? false : undefined)} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (props.target && props.target !== '_self') || props.download) return;
    if (analytics) track(analytics.name, analytics.props);
    if (resultNavigation) {
      const url = new URL(event.currentTarget.href);
      if (url.origin !== window.location.origin) return;
      if (navigation) {
        event.preventDefault();
        navigation.navigate(`${url.pathname}${url.search}${url.hash}`, { replace: props.replace, scroll });
      }
      const route = publicRouteKey(url.pathname);
      const page = Number(url.searchParams.get('page') ?? '1');
      if (route && url.searchParams.has('page') && Number.isInteger(page) && page > 0 && page <= 10000 && !analytics) track('public.pagination_clicked', { route, page });
    }
  }} />;
}

function synchronizeForm(form: HTMLFormElement, search: URLSearchParams, locale: PublicLocale) {
  for (const control of Array.from(form.elements)) {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) || !control.name) continue;
    if (control.name === 'lang') { control.value = locale; continue; }
    if (control instanceof HTMLInputElement && ['submit', 'button', 'reset', 'file', 'hidden'].includes(control.type)) continue;
    const values = search.getAll(control.name);
    if (control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type)) control.checked = values.includes(control.value);
    else if (control instanceof HTMLSelectElement) {
      const options = Array.from(control.options);
      if (control.multiple) options.forEach((option) => { option.selected = values.includes(option.value); });
      else {
        const requested = values[0] ?? '';
        control.value = options.some((option) => option.value === requested) ? requested
          : options.find((option) => option.value === '')?.value ?? options.find((option) => option.defaultSelected)?.value ?? options[0]?.value ?? '';
      }
    } else control.value = values[0] ?? '';
  }
}

/** A normal GET form before hydration; only same-origin public GET submits are enhanced. */
export function PublicFilterForm({ children, method = 'get', action, onSubmit, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const locale = useLocale() === 'en' ? 'en' : 'vi';
  const navigation = useContext(NavigationContext);
  useEffect(() => { if (form.current) synchronizeForm(form.current, new URLSearchParams(query), locale); }, [query, pathname, locale]);
  return <form {...props} ref={form} method={method} action={action ?? pathname} aria-busy={navigation?.pending || undefined} onSubmit={(event) => {
    onSubmit?.(event);
    if (event.defaultPrevented || method.toLowerCase() !== 'get' || typeof action === 'function') return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
      if (submitter.formTarget && submitter.formTarget !== '_self') return;
      if (submitter.hasAttribute('formmethod') && submitter.formMethod.toLowerCase() !== 'get') return;
    }
    if (props.target && props.target !== '_self') return;
    const overriddenAction = submitter instanceof HTMLElement ? submitter.getAttribute('formaction') : null;
    const url = new URL(overriddenAction ?? (typeof action === 'string' ? action : pathname), window.location.href);
    if (url.origin !== window.location.origin || !isPublicPath(url.pathname)) return;
    event.preventDefault();
    const data = new FormData(event.currentTarget, submitter);
    const params = new URLSearchParams();
    data.forEach((value, key) => { if (typeof value === 'string' && value !== '' && key !== 'page' && key !== 'lang') params.append(key, value); });
    params.set('lang', locale);
    url.search = params.toString();
    const href = `${url.pathname}${url.search}${url.hash}`;
    const route = publicRouteKey(url.pathname);
    if (route) track('public.filters_applied', { route, hasSearch: params.has('search'), hasType: params.has('type'), hasTag: params.has('tag'), hasPathway: params.has('pathway'), hasSkill: params.has('skill'), hasCourse: params.has('course'), openNow: params.get('openNow') === 'true', featured: params.get('featured') === 'true' });
    if (navigation) navigation.navigate(href);
    else router.push(href, { scroll: false });
  }}>
    <input type="hidden" name="lang" value={locale} />
    {children}
  </form>;
}
