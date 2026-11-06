import type { MetadataRoute } from 'next';
import { publicCanonical } from '@/features/public-site/metadata';
import { policyPublication } from '@/features/public-site/policy-publication';

export const dynamic = 'force-dynamic';
export default function sitemap(): MetadataRoute.Sitemap {
  const publication = policyPublication();
  if (!publication.approved) return [];
  return ['/privacy', '/terms'].flatMap((pathname) => {
    const languages = { vi: publicCanonical(pathname, 'vi'), en: publicCanonical(pathname, 'en'), 'x-default': publicCanonical(pathname, 'vi') };
    return (['vi', 'en'] as const).map((locale) => ({ url: languages[locale], alternates: { languages }, changeFrequency: 'yearly' as const, priority: 0.3, lastModified: publication.effectiveDate! }));
  });
}
