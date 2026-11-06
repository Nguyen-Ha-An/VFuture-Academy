import { test, expect } from './fixtures';

test('retired detail paths preserve the item identifier in their redirect', async ({ request }) => {
  for (const section of ['courses', 'resources', 'projects', 'opportunities']) {
    const response = await request.get(`/${section}/example-id`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain(`/app/${section}/example-id`);
  }
});
