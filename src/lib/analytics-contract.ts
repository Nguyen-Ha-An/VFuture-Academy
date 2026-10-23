/** Browser analytics is optional. Keep this contract free of server-only imports. */
export type AnalyticsProps = Record<string, string | number | boolean | null>;

export const PUBLIC_ROUTE_KEYS = [
  'home', 'academy', 'courses', 'course_detail', 'projects', 'project_detail',
  'opportunities', 'opportunity_detail', 'resources', 'resource_detail',
  'privacy', 'terms', 'contact',
] as const;
export type PublicRouteKey = (typeof PUBLIC_ROUTE_KEYS)[number];
export type PublicCatalogKey = 'courses' | 'projects' | 'opportunities' | 'resources';
export const PUBLIC_CTA_KEYS = [
  'browse_courses', 'view_course', 'view_project', 'view_opportunity', 'view_resource',
  'apply', 'enroll', 'login', 'signup', 'contact', 'download', 'explore', 'back_to_catalog',
] as const;

export type PublicAnalyticsEvents = {
  'public.page_viewed': { route: PublicRouteKey; locale?: 'vi' | 'en' };
  'public.card_clicked': { route: PublicRouteKey; catalog: PublicCatalogKey; itemId: string };
  'public.filters_applied': {
    route: PublicRouteKey; hasSearch?: boolean; hasType?: boolean; hasTag?: boolean;
    hasPathway?: boolean; hasSkill?: boolean; hasCourse?: boolean; openNow?: boolean; featured?: boolean;
  };
  'public.pagination_clicked': { route: PublicRouteKey; page: number };
  'public.cta_clicked': { route: PublicRouteKey; cta: (typeof PUBLIC_CTA_KEYS)[number]; itemId?: string };
};
export type PublicAnalyticsEventName = keyof PublicAnalyticsEvents;

export const BROWSER_ANALYTICS_EVENT_NAMES = [
  'landing.cta_clicked', 'landing.course_card_clicked', 'opportunity.viewed', 'opportunity.clicked',
  'public.page_viewed', 'public.card_clicked', 'public.filters_applied',
  'public.pagination_clicked', 'public.cta_clicked',
] as const;
export type BrowserAnalyticsEventName = (typeof BROWSER_ANALYTICS_EVENT_NAMES)[number];
export type BrowserAnalyticsEvent = { name: BrowserAnalyticsEventName; props: AnalyticsProps };

export const MAX_ANALYTICS_BATCH_SIZE = 50;
export const MAX_ANALYTICS_BODY_BYTES = 64 * 1024;
export const MAX_ANALYTICS_PROPS_BYTES = 4 * 1024;

type Validator = (value: unknown) => boolean;
const oneOf = (values: readonly string[]): Validator => (value) => typeof value === 'string' && values.includes(value);
const route = oneOf(PUBLIC_ROUTE_KEYS);
const publicId: Validator = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value);
const boolean: Validator = (value) => typeof value === 'boolean';
const rules: Record<BrowserAnalyticsEventName, { required: Record<string, Validator>; optional?: Record<string, Validator> }> = {
  'landing.cta_clicked': {
    required: { cta: oneOf(['hero', 'hero-primary', 'hero-secondary', 'final-primary', 'final-secondary',
      'hero-browse-courses', 'hero-sign-in', 'hero-create-account', 'hero-ecosystem', 'academy-panel', 'closing-academy']) },
    optional: { surface: oneOf(['labs', 'academy']) },
  },
  'landing.course_card_clicked': { required: { courseId: publicId } },
  'opportunity.viewed': { required: { opportunityId: publicId } },
  'opportunity.clicked': { required: { opportunityId: publicId, application: oneOf(['internal', 'external']) } },
  'public.page_viewed': { required: { route }, optional: { locale: oneOf(['vi', 'en']) } },
  'public.card_clicked': { required: { route, catalog: oneOf(['courses', 'projects', 'opportunities', 'resources']), itemId: publicId } },
  'public.filters_applied': {
    required: { route }, optional: { hasSearch: boolean, hasType: boolean, hasTag: boolean,
      hasPathway: boolean, hasSkill: boolean, hasCourse: boolean, openNow: boolean, featured: boolean },
  },
  'public.pagination_clicked': { required: { route, page: (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10_000 } },
  'public.cta_clicked': { required: { route, cta: oneOf(PUBLIC_CTA_KEYS) }, optional: { itemId: publicId } },
};

/** Reject entire events with unrecognized fields; never turn arbitrary text into telemetry. */
export function isBrowserAnalyticsEvent(name: unknown, props: unknown): name is BrowserAnalyticsEventName {
  if (typeof name !== 'string' || !Object.hasOwn(rules, name)) return false;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return false;
  const eventProps = props as Record<string, unknown>;
  const rule = rules[name as BrowserAnalyticsEventName];
  const allowed = { ...rule.required, ...rule.optional };
  const entries = Object.entries(eventProps);
  if (entries.length > 20 || Object.keys(rule.required).some((key) => !Object.hasOwn(eventProps, key))) return false;
  if (!entries.every(([key, value]) => key.length <= 64 && Object.hasOwn(allowed, key)
    && allowed[key](value) && (typeof value !== 'string' || value.length <= 240))) return false;
  try {
    return new TextEncoder().encode(JSON.stringify(eventProps)).byteLength <= MAX_ANALYTICS_PROPS_BYTES;
  } catch {
    return false;
  }
}
