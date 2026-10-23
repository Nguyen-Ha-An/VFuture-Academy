import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { cache } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { verify } from '@/features/certificates/service';
import { checkPublicRateLimit } from '@/features/marketing/public-http';

export const dynamic = 'force-dynamic';

const verificationForPage = cache(async (code: string) => {
  const requestHeaders = await headers();
  const decision = checkPublicRateLimit(new Request(
    `https://academy.invalid/verify/${encodeURIComponent(code)}`,
    { headers: requestHeaders },
  ));
  if (!decision.allowed) return { rateLimited: true as const, certificate: null };
  return { rateLimited: false as const, certificate: await verify(code) };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const lookup = await verificationForPage(code);
  return {
    title: lookup.certificate
      ? `${lookup.certificate.courseTitle} certificate | VFuture Academy`
      : 'Certificate verification | VFuture Academy',
  };
}

export default async function CertificateVerificationPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const [locale, t, lookup] = await Promise.all([
    getLocale(),
    getTranslations('certificateVerification'),
    verificationForPage(code),
  ]);
  const { certificate, rateLimited } = lookup;
  const date = certificate
    ? new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date(certificate.issuedAt))
    : null;

  return (
    <main id="main-content" className="grid min-h-screen place-items-center bg-muted/30 px-5 py-12">
      <section className="w-full max-w-2xl rounded-2xl border border-border bg-background p-7 shadow-sm sm:p-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-semibold tracking-tight">VFuture Academy</Link>
          <LocaleSwitcher />
        </header>
        <div className="mt-12">
          <p className="font-mono text-xs font-medium tracking-[0.18em] text-primary uppercase">{t('eyebrow')}</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            {rateLimited
              ? locale === 'vi' ? 'Táº¡m thá»i khÃ´ng thá»ƒ xÃ¡c minh' : 'Verification temporarily unavailable'
              : certificate ? t('validTitle') : t('invalidTitle')}
          </h1>
          <p className="mt-4 text-muted-foreground">
            {rateLimited
              ? locale === 'vi' ? 'Báº¡n Ä‘Ã£ thá»­ quÃ¡ nhiá»u láº§n. Vui lÃ²ng thá»­ láº¡i sau.' : 'Too many verification requests. Please try again soon.'
              : certificate ? t('validDescription') : t('invalidDescription')}
          </p>
        </div>
        {certificate ? (
          <dl className="mt-8 grid gap-5 rounded-xl border border-border p-5 sm:grid-cols-2">
            <div><dt className="text-sm text-muted-foreground">{t('learner')}</dt><dd className="mt-1 font-semibold">{certificate.learnerDisplayName}</dd></div>
            <div><dt className="text-sm text-muted-foreground">{t('course')}</dt><dd className="mt-1 font-semibold">{certificate.courseTitle}</dd></div>
            <div><dt className="text-sm text-muted-foreground">{t('issued')}</dt><dd className="mt-1">{date}</dd></div>
            <div><dt className="text-sm text-muted-foreground">{t('serial')}</dt><dd className="mt-1 font-mono text-sm">{certificate.serial}</dd></div>
          </dl>
        ) : null}
        {certificate?.pdfUrl ? (
          <a
            href={certificate.pdfUrl}
            rel="noreferrer"
            className="mt-8 mr-5 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
          >
            {locale === 'vi' ? 'Táº£i chá»©ng nháº­n' : 'Download certificate'}
          </a>
        ) : null}
        <Link href="/courses" className="mt-8 inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">{t('browseCourses')}</Link>
      </section>
    </main>
  );
}
