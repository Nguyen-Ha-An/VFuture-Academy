import 'server-only';

import { createElement } from 'react';
import type { Metadata } from 'next';
import { env } from '@/lib/env';
import { CONTACT_EMAIL, SITE_NAME } from './site-config';

type PublicLocale = 'vi' | 'en';

/** Deliberately rebuild URLs: filters, return context and arbitrary query data are never canonical. */
export function publicCanonical(pathname: string, locale: PublicLocale, page?: number): string {
  const path = pathname.split(/[?#]/, 1)[0];
  const url = new URL(path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : '/', env.NEXT_PUBLIC_APP_URL);
  if (locale === 'en') url.searchParams.set('lang', 'en');
  if (page && Number.isSafeInteger(page) && page > 1) url.searchParams.set('page', String(page));
  return url.toString();
}

export function buildPublicMetadata({ title, description, pathname, locale, page, filtered = false, image }: {
  title: string;
  description: string;
  pathname: string;
  locale: PublicLocale;
  page?: number;
  filtered?: boolean;
  image?: string;
}): Metadata {
  const canonicalPage = filtered ? undefined : page;
  const canonical = publicCanonical(pathname, locale, canonicalPage);
  const fullTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  const section = pathname.split(/[/?#]/)[1];
  const socialSections = ['academy', 'courses', 'projects', 'opportunities', 'resources', 'contact', 'privacy', 'terms'];
  const socialImage = new URL(image ?? (socialSections.includes(section) ? `/social/${section}?lang=${locale}` : '/opengraph-image'), env.NEXT_PUBLIC_APP_URL).toString();
  return {
    title: { absolute: fullTitle }, description,
    alternates: {
      canonical,
      languages: {
        vi: publicCanonical(pathname, 'vi', canonicalPage),
        en: publicCanonical(pathname, 'en', canonicalPage),
        'x-default': publicCanonical(pathname, 'vi', canonicalPage),
      },
    },
    robots: { index: !filtered, follow: true },
    openGraph: { type: 'website', siteName: SITE_NAME, title: fullTitle, description, url: canonical, locale: locale === 'vi' ? 'vi_VN' : 'en_US', alternateLocale: locale === 'vi' ? 'en_US' : 'vi_VN', images: [{ url: socialImage, width: 1200, height: 630, alt: fullTitle }] },
    twitter: { card: 'summary_large_image', title: fullTitle, description, images: [socialImage] },
    icons: { icon: [{ url: '/labs/vfuture-symbol.svg', type: 'image/svg+xml' }] },
    ...(process.env.GOOGLE_SITE_VERIFICATION?.trim() ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION.trim() } } : {}),
  };
}

export function breadcrumbJsonLd(items: Array<{ label: string; href?: string }>, locale: PublicLocale): object {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.label, ...(item.href ? { item: publicCanonical(item.href, locale) } : {}) })),
  };
}

export function JsonLd({ data }: { data: object }) {
  return createElement('script', { type: 'application/ld+json', dangerouslySetInnerHTML: { __html: JSON.stringify(data).replace(/</g, '\\u003c') } });
}

export function OrganizationJsonLd() {
  return JsonLd({ data: {
    '@context': 'https://schema.org', '@type': 'Organization',
    '@id': `${publicCanonical('/', 'vi')}#organization`, name: SITE_NAME,
    url: publicCanonical('/', 'vi'), logo: new URL('/labs/vfuture-symbol.svg', env.NEXT_PUBLIC_APP_URL).toString(),
    email: CONTACT_EMAIL,
    sameAs: ['https://www.linkedin.com/company/vfuture/', 'https://www.facebook.com/VFutureLabs/'],
  } });
}

export function WebSiteJsonLd() {
  const url = publicCanonical('/', 'vi');
  return JsonLd({ data: {
    '@context': 'https://schema.org', '@type': 'WebSite',
    '@id': `${url}#website`, name: SITE_NAME, url,
    publisher: { '@id': `${url}#organization` },
  } });
}
