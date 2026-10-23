// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Link from 'next/link';
import { renderToString } from 'react-dom/server';

vi.mock('next-intl', () => ({ useLocale: () => 'en' }));
import { CookieConsent, CookiePreferencesButton } from '@/features/public-site/ConsentPanel';

function mount() {
  return render(<><main><Link href="/courses">Browse courses</Link></main><CookiePreferencesButton /><CookieConsent /></>);
}

describe('public cookie consent controls', () => {
  beforeEach(() => {
    document.cookie = 'vf_analytics_consent=; Path=/; Max-Age=0';
    localStorage.clear();
  });
  afterEach(cleanup);

  it('renders no fixed banner or inactive consent actions in server HTML without JavaScript', () => {
    const html = renderToString(<CookieConsent />);
    expect(html).not.toContain('class="consent-banner"');
    expect(html).not.toContain('data-consent-open');
    expect(html).not.toContain('<button');
    expect(html).toContain('<noscript>');
    expect(html).toContain('Optional analytics does not run without JavaScript.');
    expect(html).toContain('class="consent-noscript"');
    expect(document.cookie).not.toContain('vf_analytics_consent=');
  });

  it('offers equally available accept, reject and manage actions without a blocking dialog', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Your cookie choice' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Accept analytics' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject analytics' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Manage cookies' })).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse courses' })).toBeVisible();
    expect(document.querySelector('[data-consent-open="true"]')).not.toBeNull();
  });

  it('remembers rejection and allows the footer to reopen preferences and grant analytics', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reject analytics' }));
    expect(document.cookie).toContain('vf_analytics_consent=v1.denied');
    expect(screen.queryByRole('heading', { name: 'Your cookie choice' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cookie preferences' }));
    expect(screen.getByRole('dialog', { name: 'Cookie preferences' })).toHaveAttribute('data-consent-open', 'true');
    const checkbox = screen.getByRole('checkbox', { name: 'Optional first-party analytics' });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    expect(document.cookie).toContain('vf_analytics_consent=v1.granted');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cookie preferences' })).toHaveFocus());
    expect(localStorage.getItem('vf_analytics_consent')).toBeNull();
  });

  it('discloses verified account association and permits withdrawal', () => {
    document.cookie = 'vf_analytics_consent=v1.granted; Path=/';
    mount();
    expect(screen.queryByRole('heading', { name: 'Your cookie choice' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cookie preferences' }));
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText(/linked to your verified account/)).toBeVisible();
    expect(screen.getByText(/180 days/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Reject analytics' }));
    expect(document.cookie).toContain('vf_analytics_consent=v1.denied');
  });

  it('closes preferences with Escape without granting consent', async () => {
    mount();
    const manage = screen.getByRole('button', { name: 'Manage cookies' });
    fireEvent.click(manage);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.cookie).not.toContain('vf_analytics_consent=');
    const restoredManage = screen.getByRole('button', { name: 'Manage cookies' });
    expect(restoredManage).not.toBe(manage);
    await waitFor(() => expect(restoredManage).toHaveFocus());
  });

  it('restores focus to the current banner Manage button when closing without a choice', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Manage cookies' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close preferences' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Manage cookies' })).toHaveFocus());
    expect(document.cookie).not.toContain('vf_analytics_consent=');
  });

  it.each(['granted', 'denied'])('returns focus to footer preferences after saving %s from the banner dialog', async (choice) => {
    mount();
    const originalManage = screen.getByRole('button', { name: 'Manage cookies' });
    fireEvent.click(originalManage);
    if (choice === 'granted') fireEvent.click(screen.getByRole('checkbox', { name: 'Optional first-party analytics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.cookie).toContain(`vf_analytics_consent=v1.${choice}`);
    expect(originalManage.isConnected).toBe(false);
    expect(screen.queryByRole('button', { name: 'Manage cookies' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cookie preferences' })).toHaveFocus());
  });

  it('reflects another tab saving the preference', async () => {
    mount();
    document.cookie = 'vf_analytics_consent=v1.denied; Path=/';
    fireEvent(window, new StorageEvent('storage', { key: 'vf_analytics_consent', newValue: 'v1.denied' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Your cookie choice' })).not.toBeInTheDocument());
  });
});
