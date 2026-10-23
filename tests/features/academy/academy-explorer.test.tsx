// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { PATHWAYS } from '@/content-engine';
import { AcademyExplorer } from '@/features/public-site/academy/AcademyExplorer';
import enMessages from '@/messages/en.json';
import viMessages from '@/messages/vi.json';

const fields = [
  ['ai-emerging-technology', 'aiEmergingTechnology'],
  ['research-innovation', 'researchInnovation'],
  ['entrepreneurship-product', 'entrepreneurshipProduct'],
  ['fintech-economics', 'fintechEconomics'],
  ['core-future-skills', 'coreFutureSkills'],
] as const;

afterEach(cleanup);

describe('Academy field explorer', () => {
  it.each(['en', 'vi'] as const)('shows a useful default preview and real destination in %s', (locale) => {
    const messages = locale === 'en' ? enMessages : viMessages;
    render(<NextIntlClientProvider locale={locale} messages={messages}><AcademyExplorer fields={PATHWAYS} /></NextIntlClientProvider>);
    const first = messages.marketing.pathways.items.aiEmergingTechnology;
    const selectors = screen.getByRole('group', { name: messages.labs.academy.explorer.label });
    expect(within(selectors).getAllByRole('button')).toHaveLength(5);
    expect(screen.getByRole('heading', { level: 3, name: first.name })).toBeTruthy();
    expect(screen.getByText(first.promise)).toBeTruthy();
    expect(screen.getByRole('button', { name: first.name }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('link', { name: `${messages.labs.academy.explorer.cta}: ${first.name}` }).getAttribute('href')).toBe(`/courses?pathway=ai-emerging-technology&lang=${locale}`);
  });

  it.each(['en', 'vi'] as const)('selects all five canonical fields without navigating in %s', async (locale) => {
    const user = userEvent.setup();
    const messages = locale === 'en' ? enMessages : viMessages;
    const { container } = render(<NextIntlClientProvider locale={locale} messages={messages}><AcademyExplorer fields={PATHWAYS} /></NextIntlClientProvider>);
    for (const [pathway, key] of fields) {
      const field = messages.marketing.pathways.items[key];
      await user.click(screen.getByRole('button', { name: field.name }));
      expect(screen.getByRole('heading', { name: field.name })).toBeTruthy();
      expect(screen.getByText(field.promise)).toBeTruthy();
      expect(screen.getByRole('link').getAttribute('href')).toBe(`/courses?pathway=${pathway}&lang=${locale}`);
      expect(container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1);
      expect(container.querySelector('[data-academy-explorer]')?.getAttribute('data-selected-field')).toBe(pathway);
    }
  });

  it('supports native keyboard selection and keeps focus on its selector', async () => {
    const user = userEvent.setup();
    render(<NextIntlClientProvider locale="en" messages={enMessages}><AcademyExplorer fields={PATHWAYS} /></NextIntlClientProvider>);
    await user.tab();
    await user.tab();
    const second = screen.getByRole('button', { name: enMessages.marketing.pathways.items.researchInnovation.name });
    expect(document.activeElement).toBe(second);
    await user.keyboard('{Enter}');
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(second);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/courses?pathway=research-innovation&lang=en');
  });
});
