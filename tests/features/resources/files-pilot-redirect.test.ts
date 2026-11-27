import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { prepareDestination } from 'next/dist/shared/lib/router/utils/prepare-destination';
import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../../next.config';

async function redirectsTo(path: string) {
  for (const route of await nextConfig.redirects?.() ?? []) {
    const params = getPathMatch(route.source, { strict: true })(path);
    if (params) {
      return prepareDestination({
        appendParamsToQuery: false, destination: route.destination, params, query: {},
      }).parsedDestination.pathname;
    }
  }
  return null;
}

afterEach(() => vi.unstubAllEnvs());

describe('Academy Files pilot public resource routing', () => {
  it('serves only the configured pilot detail on the public route with writes disabled', async () => {
    vi.stubEnv('ACADEMY_FILES_PILOT_RESOURCE_ID', 'files-stage4-pilot');
    vi.stubEnv('ACADEMY_FILES_PILOT_WRITES_ENABLED', 'false');

    expect(await redirectsTo('/resources/files-stage4-pilot')).toBeNull();
    expect(await redirectsTo('/resources')).toBe('/app/resources');
    expect(await redirectsTo('/resources/files-stage4-pilot-not-selected')).toBe('/app/resources/files-stage4-pilot-not-selected');
    expect(await redirectsTo('/resources/files-stage4-pilot/extra')).toBe('/app/resources/files-stage4-pilot/extra');
  });

  it.each(['', 'files-stage4-pilot|another-resource'])('preserves the learner redirect for an unconfigured or invalid pilot ID', async (id) => {
    vi.stubEnv('ACADEMY_FILES_PILOT_RESOURCE_ID', id);

    expect(await redirectsTo('/resources/files-stage4-pilot')).toBe('/app/resources/files-stage4-pilot');
  });
});
