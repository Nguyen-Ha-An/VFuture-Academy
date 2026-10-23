import { describe, expect, it } from 'vitest';
import { isBrowserAnalyticsEvent } from '@/lib/analytics-contract';
import { readAnalyticsConsent } from '@/lib/analytics-consent';

describe('analytics consent cookie contract', () => {
  it.each([null, '', 'vf_analytics_consent=v0.granted', 'vf_analytics_consent=v1.granted; vf_analytics_consent=v1.denied', 'vf_analytics_consent=v1.granted.extra'])('fails closed for %s', (cookie) => {
    expect(readAnalyticsConsent(cookie)).toBe('unknown');
  });
  it('reads the current exact preference among unrelated cookies', () => {
    expect(readAnalyticsConsent('lang=en; vf_analytics_consent=v1.granted; session=abc')).toBe('granted');
    expect(readAnalyticsConsent('vf_analytics_consent=v1.denied')).toBe('denied');
  });
});

describe('optional public event schema', () => {
  it.each([
    ['public.page_viewed', { route: 'home', locale: 'vi' }],
    ['public.card_clicked', { route: 'projects', catalog: 'projects', itemId: 'b4aab357-fb70-48aa-9e15-e52e8d2e8858' }],
    ['public.filters_applied', { route: 'resources', hasSearch: true, hasType: false }],
    ['public.pagination_clicked', { route: 'opportunities', page: 2 }],
    ['public.cta_clicked', { route: 'course_detail', cta: 'enroll', itemId: 'ai-foundations' }],
  ])('accepts bounded props for %s', (name, props) => {
    expect(isBrowserAnalyticsEvent(name, props)).toBe(true);
  });
  it.each([
    ['public.page_viewed', {}],
    ['public.page_viewed', { route: 'home', locale: 'fr' }],
    ['public.card_clicked', { route: 'courses', catalog: 'courses', itemId: 'x'.repeat(97) }],
    ['public.filters_applied', { route: 'resources', hasSearch: 'some text' }],
    ['public.pagination_clicked', { route: 'courses', page: 1.5 }],
    ['public.pagination_clicked', { route: 'courses', page: 10001 }],
    ['public.cta_clicked', { route: 'home', cta: 'contact', href: 'mailto:private@example.com' }],
    ['public.page_viewed', { route: 'home', email: 'private@example.com' }],
    ['constructor', {}],
    ['exam.submitted', { itemId: 'exam' }],
  ])('rejects unsafe or invalid %s %j', (name, props) => {
    expect(isBrowserAnalyticsEvent(name, props)).toBe(false);
  });
});
