import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://vfuture.example' } }));
import { breadcrumbJsonLd, buildPublicMetadata, JsonLd, OrganizationJsonLd, WebSiteJsonLd } from '@/features/public-site/metadata';

afterEach(() => vi.unstubAllEnvs());
const input = { title: 'Resources', description: 'Useful learning resources', pathname: '/resources', locale: 'vi' as const };
describe('public metadata', () => {
  it('keeps unfiltered pagination distinct in both language canonicals', () => {
    const metadata = buildPublicMetadata({ ...input, locale: 'en', page: 3 });
    expect(metadata.alternates?.canonical).toBe('https://vfuture.example/resources?lang=en&page=3');
    expect(metadata.alternates?.languages).toEqual({ vi: 'https://vfuture.example/resources?page=3', en: 'https://vfuture.example/resources?lang=en&page=3', 'x-default': 'https://vfuture.example/resources?page=3' });
    expect(buildPublicMetadata({ ...input, page: 1 }).alternates?.canonical).toBe('https://vfuture.example/resources');
  });
  it('excludes arbitrary query context and noindexes filtered results without losing follow', () => {
    const metadata = buildPublicMetadata({ ...input, pathname: '/resources?search=private+query&page=7#result', page: 7, filtered: true });
    expect(metadata.alternates?.canonical).toBe('https://vfuture.example/resources');
    expect(metadata.robots).toEqual({ index: false, follow: true });
    expect(buildPublicMetadata({ ...input, pathname: '/resources/guide?tag=data&page=4' }).alternates?.canonical).toBe('https://vfuture.example/resources/guide');
  });
  it('provides absolute branded social and icon metadata, with optional owner-supplied verification', () => {
    vi.stubEnv('GOOGLE_SITE_VERIFICATION', '');
    expect(buildPublicMetadata(input).verification).toBeUndefined();
    vi.stubEnv('GOOGLE_SITE_VERIFICATION', ' owner-token ');
    const metadata = buildPublicMetadata(input);
    expect(metadata.verification).toEqual({ google: 'owner-token' });
    expect(metadata.openGraph?.images).toEqual([{ url: 'https://vfuture.example/social/resources?lang=vi', width: 1200, height: 630, alt: 'Resources | VFuture Academy' }]);
    expect(metadata.icons).toEqual({ icon: [{ url: '/labs/vfuture-symbol.svg', type: 'image/svg+xml' }] });
  });
  it('escapes script breakout while preserving exact JSON-decoded text', () => {
    const value = '</script><script>alert("x")</script> and 2 < 3';
    const element = JsonLd({ data: { value } });
    const serialized = element.props.dangerouslySetInnerHTML!.__html as string;
    expect(serialized).not.toContain('<');
    expect(JSON.parse(serialized)).toEqual({ value });
    expect(renderToStaticMarkup(element).match(/<script/g)).toHaveLength(1);
  });
  it('connects the site name to verified organization profiles without inventing an address', () => {
    expect(breadcrumbJsonLd([{ label: 'Labs', href: '/' }, { label: 'Resources' }], 'en')).toMatchObject({ itemListElement: [{ position: 1, item: 'https://vfuture.example/?lang=en' }, { position: 2, name: 'Resources' }] });
    const data = JSON.parse(OrganizationJsonLd().props.dangerouslySetInnerHTML!.__html as string);
    expect(data).toMatchObject({ '@type': 'Organization', name: 'VFuture Academy', email: 'contact@vfuturelabs.org' });
    expect(data).not.toHaveProperty('address');
    expect(data.sameAs).toEqual([
      'https://www.linkedin.com/company/vfuture/',
      'https://www.facebook.com/VFutureLabs/',
    ]);
    const site = JSON.parse(WebSiteJsonLd().props.dangerouslySetInnerHTML!.__html as string);
    expect(site).toMatchObject({
      '@type': 'WebSite', name: 'VFuture Academy', url: 'https://vfuture.example/',
      publisher: { '@id': 'https://vfuture.example/#organization' },
    });
    expect(site).not.toHaveProperty('alternateName');
  });
});
