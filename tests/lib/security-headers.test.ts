import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EMBED_HOSTS,
  MEDIA_HOSTS,
} from '@/content-engine/schema/rich-content';
import {
  buildImageRemotePatterns,
  buildSecurityHeaders,
  buildStaticAssetSecurityHeaders,
} from '@/lib/security-headers';

function headerValue(headers: readonly { key: string; value: string }[], key: string) {
  return headers.find((header) => header.key === key)?.value;
}

function directive(csp: string, name: string) {
  return csp.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${name} `)) ?? '';
}

describe('security headers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('builds a production CSP containing every explicit content and Supabase host without wildcards', () => {
    const headers = buildSecurityHeaders({
      nodeEnv: 'production',
      nonce: 'request-nonce',
      supabaseUrl: 'https://academy-project.supabase.co/storage/v1',
    });
    const csp = headerValue(headers, 'Content-Security-Policy');

    expect(csp).toBeDefined();
    const frameSources = directive(csp!, 'frame-src');
    const imageSources = directive(csp!, 'img-src');
    const connectSources = directive(csp!, 'connect-src');
    for (const host of EMBED_HOSTS) {
      expect(frameSources, `frame-src missing ${host}`).toContain(`https://${host}`);
    }
    for (const providerHost of ['www.youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com']) {
      expect(frameSources, `frame-src missing provider ${providerHost}`).toContain(`https://${providerHost}`);
    }
    for (const host of MEDIA_HOSTS) {
      expect(frameSources, `frame-src missing PDF host ${host}`).toContain(`https://${host}`);
      expect(imageSources, `img-src missing ${host}`).toContain(`https://${host}`);
    }
    expect(frameSources).toContain("'self'");
    expect(frameSources).toContain('https://academy-project.supabase.co');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(imageSources).toContain("img-src 'self' data: blob: https://academy-project.supabase.co");
    expect(connectSources).toContain("connect-src 'self' https://academy-project.supabase.co");
    const scriptSources = directive(csp!, 'script-src');
    expect(scriptSources).toContain("script-src 'self' 'nonce-request-nonce' 'strict-dynamic'");
    expect(scriptSources).not.toContain("'unsafe-inline'");
    expect(scriptSources).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain('*');
  });

  it('adds HSTS only in production', () => {
    const production = buildSecurityHeaders({ nodeEnv: 'production', nonce: 'request-nonce' });
    const development = buildSecurityHeaders({ nodeEnv: 'development' });

    expect(headerValue(production, 'Strict-Transport-Security'))
      .toBe('max-age=63072000; includeSubDomains; preload');
    expect(headerValue(development, 'Strict-Transport-Security')).toBeUndefined();
  });

  it('applies a sandboxed deny-all CSP to middleware-excluded static responses', () => {
    const headers = buildStaticAssetSecurityHeaders({ nodeEnv: 'production' });

    expect(headerValue(headers, 'Content-Security-Policy')).toBe("default-src 'none'; sandbox");
  });

  it('adds only the configured public Sentry DSN origin to connect-src', () => {
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public-key@errors.example.com/42');

    const csp = headerValue(buildSecurityHeaders({
      nodeEnv: 'production',
      nonce: 'request-nonce',
      supabaseUrl: 'https://academy-project.supabase.co',
    }), 'Content-Security-Policy');

    expect(directive(csp!, 'connect-src'))
      .toBe("connect-src 'self' https://academy-project.supabase.co https://errors.example.com");
    expect(csp).not.toContain('public-key@');
  });

  it('keeps development scripts permissive and emits the remaining defense headers', () => {
    const headers = buildSecurityHeaders({ nodeEnv: 'development' });

    expect(headerValue(headers, 'Content-Security-Policy')).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(headerValue(headers, 'X-Content-Type-Options')).toBe('nosniff');
    expect(headerValue(headers, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headerValue(headers, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('builds Next image patterns from the media hosts plus only the configured Supabase project', () => {
    const patterns = buildImageRemotePatterns({
      supabaseUrl: 'https://academy-project.supabase.co/storage/v1',
    });

    expect(patterns.map(String)).toEqual([
      ...MEDIA_HOSTS.map((host) => `https://${host}/**`),
      'https://academy-project.supabase.co/**',
    ]);
    expect(patterns.map(String).join(' ')).not.toContain('*.supabase.co');
  });

  it('wires the shared image patterns into the Next image optimizer', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://academy-project.supabase.co/storage/v1');
    vi.resetModules();

    const { default: nextConfig } = await import('../../next.config');
    const patterns = typeof nextConfig === 'function'
      ? []
      : nextConfig.images?.remotePatterns ?? [];

    expect(patterns.map(String)).toEqual([
      ...MEDIA_HOSTS.map((host) => `https://${host}/**`),
      'https://academy-project.supabase.co/**',
    ]);
  });

  it('keeps the global rule CSP-free and scopes the sandbox CSP to static asset sources', async () => {
    const source = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');

    expect(source).toMatch(/source:\s*["']\/\(\.\*\)["']\s*,\s*headers:\s*GLOBAL_SECURITY_HEADERS/);

    vi.resetModules();
    const { default: nextConfig } = await import('../../next.config');
    expect(typeof nextConfig).not.toBe('function');
    if (typeof nextConfig === 'function') throw new Error('Expected an object Next config');

    const rules = await nextConfig.headers?.();
    expect(rules).toBeDefined();
    const globalRule = rules!.find((rule) => rule.source === '/(.*)');
    expect(globalRule).toBeDefined();
    expect(headerValue(globalRule!.headers, 'Content-Security-Policy')).toBeUndefined();

    const sandboxSources = rules!
      .filter((rule) => headerValue(rule.headers, 'Content-Security-Policy') === "default-src 'none'; sandbox")
      .map((rule) => rule.source);
    expect(sandboxSources).toEqual([
      '/_next/static/:path*',
      '/_next/image',
      '/favicon.ico',
      '/:path*(\\.svg|\\.png|\\.jpg|\\.jpeg|\\.gif|\\.webp|\\.ico|\\.woff2?)',
    ]);
    expect(sandboxSources).not.toContain('/');
    expect(sandboxSources).not.toContain('/courses');
    expect(sandboxSources).not.toContain('/(.*)');
  });
});
