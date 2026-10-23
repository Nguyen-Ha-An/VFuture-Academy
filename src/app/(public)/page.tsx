import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { PATHWAYS, type Locale } from '@/content-engine';
import { AcademyGateway } from '@/features/public-site/academy/AcademyGateway';
import { buildPublicMetadata, publicCanonical, WebSiteJsonLd } from '@/features/public-site/metadata';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale() as Promise<Locale>, getTranslations('marketing.metadata')]);
  const metadata = buildPublicMetadata({ title: t('homeTitle'), description: t('homeDescription'), pathname: '/', locale });
  // Next 15 drops root query strings from URL metadata. Render canonical and
  // language URLs explicitly so the English root keeps its own identity.
  metadata.alternates = undefined;
  if (metadata.openGraph) metadata.openGraph = { ...metadata.openGraph, url: undefined };
  return metadata;
}

export default async function AcademyHomePage() {
  const locale = await getLocale() === 'en' ? 'en' : 'vi';
  const canonical = publicCanonical('/', locale);
  return <>
    <link rel="canonical" href={canonical} />
    <link rel="alternate" hrefLang="vi" href={publicCanonical('/', 'vi')} />
    <link rel="alternate" hrefLang="en" href={publicCanonical('/', 'en')} />
    <link rel="alternate" hrefLang="x-default" href={publicCanonical('/', 'vi')} />
    <meta property="og:url" content={canonical} />
    <WebSiteJsonLd />
    <main id="main-content"><AcademyGateway fields={PATHWAYS} /></main>
  </>;
}
