import { staffLegacyRedirects } from './src/lib/staff-legacy-redirects';
import { notebookRuntimeUrl } from './src/features/notebooks/config';
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import {
  buildImageRemotePatterns,
  GLOBAL_SECURITY_HEADERS,
  STATIC_ASSET_SECURITY_HEADERS,
  STUDIO_WORKER_SECURITY_HEADERS,
} from "./src/lib/security-headers";

const STATIC_ASSET_HEADER_SOURCES = [
  "/_next/static/:path*",
  "/_next/image",
  "/favicon.ico",
  "/:path*(\\.svg|\\.png|\\.jpg|\\.jpeg|\\.gif|\\.webp|\\.ico|\\.woff2?)",
];

const runtimeUrl = notebookRuntimeUrl();
const notebookOrigin = runtimeUrl ? new URL(runtimeUrl).origin : null;
const notebookHeaders = [
  {key:'Cross-Origin-Opener-Policy',value:'same-origin'},
  {key:'Cross-Origin-Embedder-Policy',value:'require-corp'},
  {key:'Permissions-Policy',value:`camera=(), microphone=(), geolocation=(), cross-origin-isolated=(self${notebookOrigin ? ' \"'+notebookOrigin+'\"' : ''})`},
];

// Local rehearsal can avoid large persistent compiler caches on constrained disks.
// The normal build has no override.
const withoutBuildCache: NextConfig['webpack'] = (config) => {
  config.cache = false;
  return config;
};

const nextConfig: NextConfig = {
  ...(process.env.ACADEMY_BUILD_CACHE === '0' ? { webpack: withoutBuildCache } : {}),
  // Let the MCP slash alias reach its route. Preserve the previous canonical
  // slash redirect for every other path with the explicit rule below.
  skipTrailingSlashRedirect: true,
  // Keep canonical/indexing tags in the head across enhanced catalog filters.
  // Streamed metadata in Next 15 can leave stale body tags after query navigation.
  htmlLimitedBots: /.*/,
  experimental: {
    authInterrupts: true,
    serverActions: { bodySizeLimit: '50mb' },
  },
  turbopack: { root: process.cwd() },
  outputFileTracingIncludes: {
    '/api/v1/**': ['./public/fonts/certificates/*.ttf'],
  },
  images: {
    remotePatterns: buildImageRemotePatterns(),
  },
  async redirects() {
    return [
      {
        source: '/:path((?!api/mcp/$).+)/',
        destination: '/:path',
        permanent: true,
      },
      ...staffLegacyRedirects,
    ];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: GLOBAL_SECURITY_HEADERS },
      { source: "/app/courses/:courseId/items/:itemId/notebook", headers: notebookHeaders },
      { source: "/studio/courses/:courseId/notebooks/:itemId", headers: notebookHeaders },
      ...(process.env.NODE_ENV !== "production" ? [{source:"/dev/notebook",headers:notebookHeaders}] : []),
      { source: "/studio-workers/:path*", headers: STUDIO_WORKER_SECURITY_HEADERS },
      ...STATIC_ASSET_HEADER_SOURCES.map((source) => ({
        source,
        headers: STATIC_ASSET_SECURITY_HEADERS,
      })),
    ];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
