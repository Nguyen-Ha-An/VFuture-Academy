/** Public URLs carry only public browsing context; authentication continuations stay exact. */
export type PublicCatalog = 'courses' | 'projects' | 'opportunities' | 'resources';
export type PublicSearchParams = Record<string, string | string[] | undefined>;
export type PublicLocale = 'vi' | 'en';

const contextKeys: Record<PublicCatalog, readonly string[]> = {
  courses: ['pathway', 'page'],
  projects: ['skill', 'course', 'page'],
  opportunities: ['type', 'openNow', 'featured', 'page'],
  resources: ['search', 'type', 'tag', 'pathway', 'page'],
};

export function isPublicPath(pathname: string): boolean {
  return pathname === '/' || /^\/(?:academy|courses|projects|opportunities|resources|privacy|terms|contact)(?:\/|$)/.test(pathname);
}

export function publicRouteKey(pathname: string): string | null {
  if (pathname === '/') return 'home';
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 1 && ['academy', 'courses', 'projects', 'opportunities', 'resources', 'privacy', 'terms', 'contact'].includes(parts[0])) return parts[0];
  const detail: Record<string, string> = { courses: 'course_detail', projects: 'project_detail', opportunities: 'opportunity_detail', resources: 'resource_detail' };
  return parts.length === 2 && Object.hasOwn(detail, parts[0]) ? detail[parts[0]] : null;
}

export function publicHref(path: string, locale: PublicLocale, query?: PublicSearchParams): string {
  // Do not parse relative, protocol-relative or external destinations into public links.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return path;
  const url = new URL(path, 'https://public.invalid');
  if (!isPublicPath(url.pathname)) return path;
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.delete(key);
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
      else if (value !== undefined) url.searchParams.set(key, value);
    }
  }
  url.searchParams.set('lang', locale);
  return `${url.pathname}${url.search}${url.hash}`;
}

function catalogContext(catalog: PublicCatalog, params: PublicSearchParams): PublicSearchParams {
  const context: PublicSearchParams = {};
  for (const key of contextKeys[catalog]) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) continue;
    if (key === 'page') {
      if (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) context.page = value;
    } else context[key] = value;
  }
  return context;
}

export function publicDetailHref(catalog: PublicCatalog, id: string, params: PublicSearchParams, locale: PublicLocale): string {
  const segment = encodeURIComponent(id).replace(/[!'()*\.]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return publicHref(`/${catalog}/${segment}`, locale, catalogContext(catalog, params));
}

export function publicBackHref(catalog: PublicCatalog, params: PublicSearchParams, locale: PublicLocale): string {
  return publicHref(`/${catalog}`, locale, catalogContext(catalog, params));
}
