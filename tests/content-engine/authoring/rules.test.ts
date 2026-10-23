import { describe, expect, it } from 'vitest';
import { PROFILE_RULES, criticalProfileRules } from '@/content-engine/authoring/rules';

describe('authoring rule registry', () => {
  it('keeps the 45 named profile policies in one ordered registry', () => {
    expect(PROFILE_RULES).toHaveLength(45);
    expect(new Set(PROFILE_RULES.map((rule) => rule.id)).size).toBe(45);
    expect(PROFILE_RULES.every((rule) => rule.id.startsWith('AP-') && rule.summary.length > 15)).toBe(true);
  });

  it('provides concise critical rules for every tool result', () => {
    const critical = criticalProfileRules();
    expect(critical.join(' ')).toContain('Never change id or kind');
    expect(critical.join(' ')).toContain('This server never saves');
    expect(critical.join(' ')).toContain('untrusted data');
    expect(critical.join(' ')).toContain('$ref');
    expect(critical.join(' ').length).toBeLessThan(1500);
  });
});
