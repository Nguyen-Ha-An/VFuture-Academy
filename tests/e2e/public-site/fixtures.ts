import { test as base, expect, type BrowserContext } from '@playwright/test';

export async function isolatePublicContext(context: BrowserContext) {
  const analyticsPosts: string[] = [];
  const blockedWrites: string[] = [];
  await context.route('**/*', async (route) => {
    const request = route.request();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
    if (new URL(request.url()).pathname === '/api/v1/analytics') {
      analyticsPosts.push(request.postData() ?? '');
      return route.fulfill({ status: 204 });
    }
    blockedWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.abort('blockedbyclient');
  });
  return { analyticsPosts, blockedWrites };
}

export const test = base.extend<{ publicTraffic: Awaited<ReturnType<typeof isolatePublicContext>> }>({
  publicTraffic: [async ({ context }, use) => {
    const traffic = await isolatePublicContext(context);
    await use(traffic);
    expect(traffic.blockedWrites, 'Public browsing must never submit auth/email/application/database writes').toEqual([]);
  }, { auto: true }],
});
export { expect };
