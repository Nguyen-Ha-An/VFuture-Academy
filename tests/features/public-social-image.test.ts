import { describe, expect, it } from 'vitest';
import { GET } from '@/app/social/[section]/route';

describe('bounded public social images', () => {
  it('rejects unknown section names before image work', async () => {
    const response = await GET(new Request('https://vfuture.example/social/private-user'), { params: Promise.resolve({ section: 'private-user' }) });
    expect(response.status).toBe(404);
  });
  it('renders a Vietnamese section image as 1200×630 PNG without using arbitrary query text', async () => {
    const response = await GET(new Request('https://vfuture.example/social/courses?lang=vi&title=ignored'), { params: Promise.resolve({ section: 'courses' }) });
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });
});
