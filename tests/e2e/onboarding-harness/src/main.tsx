import React from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { WelcomeForm } from '@/components/WelcomeForm';
import en from '../../../../src/messages/en.json';
import vi from '../../../../src/messages/vi.json';
import '@/app/globals.css';

const query = new URLSearchParams(window.location.search);
const locale = query.get('lang') === 'vi' ? 'vi' : 'en';
document.documentElement.lang = locale;

function Harness() {
  if (window.location.pathname !== '/welcome') {
    return (
      <main className="mx-auto max-w-lg p-8">
        <h1>Onboarding destination fixture</h1>
        <p>This document is a local destination fixture, not the authenticated application.</p>
        <output aria-label="Destination path">
          {window.location.pathname + window.location.search + window.location.hash}
        </output>
      </main>
    );
  }
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'vi' ? vi : en} timeZone="UTC">
      <main className="flex min-h-screen items-center px-4 py-8">
        <WelcomeForm next={query.get('next') ?? undefined} />
      </main>
    </NextIntlClientProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
