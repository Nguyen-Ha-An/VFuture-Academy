import { notebookRuntimeUrl } from '../features/notebooks/config';
import {
  EMBED_HOSTS,
  MEDIA_HOSTS,
  VIDEO_PROVIDER_HOSTS,
} from '../content-engine/schema/rich-content';

const VIDEO_FRAME_HOSTS = [
  ...VIDEO_PROVIDER_HOSTS.youtube,
  ...VIDEO_PROVIDER_HOSTS.vimeo,
];

export const FRAME_HOSTS = [...new Set([...EMBED_HOSTS, ...VIDEO_FRAME_HOSTS])];
export const IMAGE_HOSTS = [...MEDIA_HOSTS];

type SecurityHeaderOptions = {
  nodeEnv?: string;
  nonce?: string;
  sentryDsn?: string;
  supabaseUrl?: string;
};

function origin(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

function httpsOrigins(hosts: readonly string[]) {
  return hosts.map((host) => `https://${host}`);
}

export function buildImageRemotePatterns({
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
}: Pick<SecurityHeaderOptions, 'supabaseUrl'> = {}) {
  const supabaseOrigin = origin(supabaseUrl);
  return [
    ...httpsOrigins(IMAGE_HOSTS),
    ...(supabaseOrigin ? [supabaseOrigin] : []),
  ].map((allowedOrigin) => new URL('/**', `${allowedOrigin}/`));
}

export function buildContentSecurityPolicy({
  nodeEnv = process.env.NODE_ENV,
  nonce,
  sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN,
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL,
}: SecurityHeaderOptions = {}) {
  const supabaseOrigin = origin(supabaseUrl);
  const sentryOrigin = origin(sentryDsn);
  const imageSources = ["'self'", 'data:', 'blob:', ...(supabaseOrigin ? [supabaseOrigin] : []), ...httpsOrigins(IMAGE_HOSTS)];
  const connectSources = [...new Set(["'self'", supabaseOrigin, sentryOrigin].filter((value): value is string => Boolean(value)))];
  const runtimeUrl = notebookRuntimeUrl();
  const frameSources = [...(runtimeUrl ? [new URL(runtimeUrl).origin] : []), "'self'", ...(supabaseOrigin ? [supabaseOrigin] : []), ...httpsOrigins(FRAME_HOSTS), ...httpsOrigins(IMAGE_HOSTS)];
  const mediaSources = ["'self'", 'blob:', ...(supabaseOrigin ? [supabaseOrigin] : []), ...httpsOrigins(IMAGE_HOSTS)];

  const scriptSources = nodeEnv === 'development'
    ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
    : ["'self'", ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : [])];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `frame-src ${frameSources.join(' ')}`,
    `img-src ${imageSources.join(' ')}`,
    `media-src ${mediaSources.join(' ')}`,
    `script-src ${scriptSources.join(' ')}`,
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src ${connectSources.join(' ')}`,
    "manifest-src 'self'",
    ...(nodeEnv === 'production' ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function buildSecurityHeaders(options: SecurityHeaderOptions = {}) {
  return [
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(options) },
    ...buildGlobalSecurityHeaders(options),
  ];
}

export function buildGlobalSecurityHeaders({
  nodeEnv = process.env.NODE_ENV,
}: Pick<SecurityHeaderOptions, 'nodeEnv'> = {}) {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ...(nodeEnv === 'production' ? [{
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    }] : []),
  ];
}

export function buildStaticAssetSecurityHeaders(options: Pick<SecurityHeaderOptions, 'nodeEnv'> = {}) {
  return [
    { key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" },
    ...buildGlobalSecurityHeaders(options),
  ];
}

export const GLOBAL_SECURITY_HEADERS = buildGlobalSecurityHeaders();
export const STATIC_ASSET_SECURITY_HEADERS = buildStaticAssetSecurityHeaders();

/** The self-contained authoring worker performs no fetches or nested worker loads. */
export const STUDIO_WORKER_SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'" },
  { key: 'Cache-Control', value: 'no-cache, max-age=0, must-revalidate' },
];
