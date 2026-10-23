import { httpOrigin, type ReadinessEnvironment } from './environment-readiness';

interface PlaywrightTarget {
  baseURL: string;
  storageState?: string;
  webServer?: { command: string; url: string; reuseExistingServer: boolean; timeout: number };
}

export function playwrightTarget(source: ReadinessEnvironment): PlaywrightTarget {
  const target = source.PLAYWRIGHT_TARGET ?? 'local';
  if (target !== 'local' && target !== 'remote') throw new Error('PLAYWRIGHT_TARGET must be local or remote.');
  if (target === 'remote' && !source.NEXT_PUBLIC_APP_URL) throw new Error('Remote Playwright requires NEXT_PUBLIC_APP_URL.');
  const baseURL = source.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000';
  const origin = httpOrigin(baseURL);
  if (!origin) throw new Error('Playwright requires an HTTP(S) origin without credentials, path, query, or fragment.');
  if (target === 'remote') return {
    baseURL: origin.origin,
    ...(source.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { storageState: 'playwright/.auth/remote-access.json' }
      : {}),
  };
  if (!['localhost', '127.0.0.1'].includes(origin.hostname) || origin.protocol !== 'http:') {
    throw new Error('Local Playwright requires a loopback HTTP origin. Set PLAYWRIGHT_TARGET=remote for staging.');
  }
  const args = origin.origin === 'http://127.0.0.1:3000' ? '' : ` -- --hostname ${origin.hostname} --port ${origin.port || '80'}`;
  const command = source.PLAYWRIGHT_WEB_SERVER === 'dev' ? `npm run dev${args}` : `npm run build && npm run start${args}`;
  return { baseURL: origin.origin, webServer: { command, url: origin.origin, reuseExistingServer: !source.CI, timeout: 240_000 } };
}
