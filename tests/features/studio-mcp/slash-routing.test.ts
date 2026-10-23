import { describe, expect, it } from 'vitest';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';
import nextConfig from '../../../next.config';

describe('MCP trailing slash routing', () => {
  it('serves /api/mcp/ directly while preserving existing slash redirects elsewhere', async () => {
    expect(nextConfig.skipTrailingSlashRedirect).toBe(true);
    const redirects = await nextConfig.redirects?.();
    const slash = redirects?.find((route) => route.destination === '/:path' && route.permanent === true);
    expect(slash).toBeDefined();
    const match = getPathMatch(slash!.source, { strict: true });
    expect(match('/api/mcp/')).toBe(false);
    for (const pathname of ['/studio/', '/studio/courses/', '/api/v1/public/courses/', '/.well-known/oauth-protected-resource/']) {
      const params = match(pathname);
      expect(params, pathname).not.toBe(false);
      const prepared = prepareDestination({ appendParamsToQuery: false, destination: slash!.destination,
        params: params || {}, query: {} });
      expect(prepared.parsedDestination.pathname).toBe(pathname.slice(0, -1));
    }
  });
});
