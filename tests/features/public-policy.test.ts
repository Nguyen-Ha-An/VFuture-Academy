import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { getPolicyContent, LEGAL_SOURCES } from '@/features/public-site/legal-content';
import { policyPublication } from '@/features/public-site/policy-publication';

describe('policy publication safeguards', () => {
  it('keeps policy drafts unapproved without an explicit approval and real effective date', () => {
    expect(policyPublication({})).toEqual({ approved: false, effectiveDate: null });
    for (const date of ['', '2026-02-30', 'not-a-date', '2026-1-1']) {
      expect(policyPublication({ PUBLIC_POLICIES_APPROVED: 'true', PUBLIC_POLICIES_EFFECTIVE_DATE: date }).approved).toBe(false);
    }
    expect(policyPublication({ PUBLIC_POLICIES_APPROVED: 'false', PUBLIC_POLICIES_EFFECTIVE_DATE: '2026-09-21' }).approved).toBe(false);
    expect(policyPublication({ PUBLIC_POLICIES_APPROVED: 'true', PUBLIC_POLICIES_EFFECTIVE_DATE: '2026-09-21' })).toEqual({ approved: true, effectiveDate: '2026-09-21' });
  });
  it('provides matching complete section coverage and verified contacts in both languages', () => {
    for (const kind of ['privacy', 'terms'] as const) {
      const en = getPolicyContent(kind, 'en');
      const viContent = getPolicyContent(kind, 'vi');
      expect(en.sections.map((section) => section.id)).toEqual(viContent.sections.map((section) => section.id));
      expect(en.sections.length).toBeGreaterThanOrEqual(10);
      for (const content of [en, viContent]) {
        const text = JSON.stringify(content);
        expect(text).toContain('NGUYEN HA AN');
        expect(text).toContain('legal@vfuturelabs.org');
        expect(text).toContain('contact@vfuturelabs.org');
        expect(content.sections.every((section) => section.paragraphs.length > 0)).toBe(true);
      }
    }
    expect(LEGAL_SOURCES.every((source) => new URL(source.href).hostname === 'vanban.chinhphu.vn')).toBe(true);
  });
});
