import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import type { Locale } from '@/content-engine';
import { getPublicProfile } from '@/features/profile/service';
import { PublicProfileView } from '@/features/profile/ui/PublicProfileView';
import { checkPublicRateLimit } from '@/features/marketing/public-http';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ handle: string }> };

const loadPublicProfile = cache(async (handle: string) => {
  const requestHeaders = await headers();
  const request = new Request(
    new URL(`/u/${encodeURIComponent(handle)}`, env.NEXT_PUBLIC_APP_URL),
    { headers: requestHeaders },
  );
  const rateLimit = await checkPublicRateLimit(request);
  if (!rateLimit.allowed) return { profile: null, rateLimited: true } as const;
  return { profile: await getPublicProfile(handle), rateLimited: false } as const;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const [{ handle }, t] = await Promise.all([
    params,
    getTranslations('profile.metadata'),
  ]);
  const { profile } = await loadPublicProfile(handle);
  if (!profile) {
    return {
      title: t('unavailableTitle'),
      robots: { index: false, follow: false },
    };
  }
  const title = t('publicTitle', { name: profile.displayName, handle: profile.handle });
  const description = t('publicDescription', { name: profile.displayName });
  const canonical = new URL(`/u/${encodeURIComponent(profile.handle)}`, env.NEXT_PUBLIC_APP_URL);
  return {
    title,
    description,
    alternates: { canonical },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'profile',
      url: canonical,
      title,
      description,
    },
  };
}

export default async function PublicProfilePage({ params }: PageProps) {
  const [{ handle }, locale] = await Promise.all([params, getLocale() as Promise<Locale>]);
  const { profile, rateLimited } = await loadPublicProfile(handle);
  if (rateLimited || !profile) notFound();

  return <main id="main-content"><PublicProfileView profile={profile} locale={locale} /></main>;
}
