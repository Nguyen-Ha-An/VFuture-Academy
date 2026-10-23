// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { AcademyHeader } from '@/features/public-site/AcademyHeader';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('ref=school'), usePathname: () => '/academy', useRouter: () => ({ push: vi.fn() }) }));
const messages = { labs: { navigation: { label: 'Main navigation', ecosystem: 'Ecosystem', projects: 'Projects', academy: 'Academy', schools: 'For schools', signIn: 'Sign in', menu: 'Open navigation', closeMenu: 'Close navigation', backToLabs: 'VFuture Labs', language: 'Language' } } };
afterEach(cleanup);
function header() {
  return render(<NextIntlClientProvider locale="en" messages={messages}><AcademyHeader /></NextIntlClientProvider>);
}
describe('Academy navigation', () => {
  it('uses the Academy brand and exposes every public catalog', () => {
    header();
    expect(screen.getByRole('link', { name: 'VFuture Academy' }).getAttribute('href')).toBe('/?lang=en');
    for (const label of ['Academy', 'Courses', 'Projects', 'Opportunities', 'Resources']) {
      expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(`/${label.toLowerCase()}?lang=en`);
    }
    expect(screen.getByRole('link', { name: 'Academy' }).getAttribute('aria-current')).toBe('page');
  });
  it('opens navigation and returns focus to its trigger on Escape', () => {
    header();
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Academy' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });
  it('preserves query parameters when changing the public locale', () => {
    header();
    expect(screen.getByRole('link', { name: 'Tiếng Việt' }).getAttribute('href')).toBe('?ref=school&lang=vi');
    expect(screen.getByRole('link', { name: 'English' }).getAttribute('href')).toBe('?ref=school&lang=en');
  });
});
