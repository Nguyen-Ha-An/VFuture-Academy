// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicDiscoveryError from '@/app/(public)/error';

afterEach(cleanup);
const messages = { publicDiscovery: { unavailableTitle: 'Content unavailable', unavailableDescription: 'Please try again or continue exploring.', retry: 'Try again' } };

describe('public error recovery', () => {
  it.each([
    ['en', 'Back to Academy', 'Contact'],
    ['vi', 'Về Academy', 'Liên hệ'],
  ] as const)('keeps retry and useful recovery destinations in %s', (locale, homeLabel, contactLabel) => {
    const reset = vi.fn();
    render(<NextIntlClientProvider locale={locale} messages={messages}><PublicDiscoveryError error={new Error('private diagnostic')} reset={reset} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: homeLabel }).getAttribute('href')).toBe(`/?lang=${locale}`);
    expect(screen.getByRole('link', { name: contactLabel }).getAttribute('href')).toBe(`/contact?lang=${locale}`);
    expect(screen.queryByText('private diagnostic')).toBeNull();
  });
});
