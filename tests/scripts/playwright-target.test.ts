import { describe, expect, it } from 'vitest';
import { playwrightTarget } from '../../scripts/lib/playwright-target';

describe('Playwright target selection', () => {
  it('defaults to a local production server', () => {
    expect(playwrightTarget({})).toMatchObject({ baseURL: 'http://127.0.0.1:3000', webServer: { command: 'npm run build && npm run start' } });
  });
  it('does not start a server for an explicit remote origin', () => {
    expect(playwrightTarget({ PLAYWRIGHT_TARGET: 'remote', NEXT_PUBLIC_APP_URL: 'https://stage.example.test' })).toEqual({ baseURL: 'https://stage.example.test' });
  });
  it('uses the remote-access cookie state only when a bypass is configured', () => {
    expect(playwrightTarget({
      PLAYWRIGHT_TARGET: 'remote',
      NEXT_PUBLIC_APP_URL: 'https://stage.example.test',
      VERCEL_AUTOMATION_BYPASS_SECRET: 'hidden',
    })).toEqual({
      baseURL: 'https://stage.example.test',
      storageState: 'playwright/.auth/remote-access.json',
    });
  });
  it.each([
    { PLAYWRIGHT_TARGET: 'remote' },
    { PLAYWRIGHT_TARGET: 'typo' },
    { NEXT_PUBLIC_APP_URL: 'https://production.example.test' },
    { PLAYWRIGHT_TARGET: 'remote', NEXT_PUBLIC_APP_URL: 'https://user:password@stage.example.test' },
    { PLAYWRIGHT_TARGET: 'remote', NEXT_PUBLIC_APP_URL: 'https://stage.example.test/path' },
  ])('rejects ambiguous or unsafe target configuration %j', (source) => {
    expect(() => playwrightTarget(source)).toThrow();
  });
  it('starts a matching local port and supports intentional dev mode', () => {
    const target = playwrightTarget({ NEXT_PUBLIC_APP_URL: 'http://localhost:3107', PLAYWRIGHT_WEB_SERVER: 'dev' });
    expect(target.webServer?.command).toBe('npm run dev -- --hostname localhost --port 3107');
  });
});
