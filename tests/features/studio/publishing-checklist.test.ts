import { describe, expect, it, vi } from 'vitest';

import type { Diagnostic, ValidationReport } from '@/content-engine/diagnostics';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { PublishChecklistSchema } from '@/features/studio/drafts';
import {
  PUBLISH_CHECKLIST_KEYS,
  PUBLISH_CHECKS,
  emptyPublishChecklist,
  evaluatePublishReadiness,
  isPublishChecklistComplete,
} from '@/features/studio/publish-checklist';

function diagnostic(code: string, severity: Diagnostic['severity']): Diagnostic {
  return { severity, code: code as Diagnostic['code'], docId: 'lesson-1', path: '', message: { vi: code, en: code } };
}

function report(diagnostics: Diagnostic[], revision = 'rev-1'): ValidationReport {
  const errors = diagnostics.filter((entry) => entry.severity === 'error');
  return {
    ok: errors.length === 0,
    errors,
    warnings: diagnostics.filter((entry) => entry.severity !== 'error'),
    summary: { modules: 1, items: { lesson: 1, exam: 0, assignment: 0 }, blocks: 1, questions: {}, totalPoints: 0, languages: ['vi'] },
    revision,
  };
}

const stateOf = (readiness: ReturnType<typeof evaluatePublishReadiness>) =>
  Object.fromEntries(readiness.items.map((item) => [item.key, item.state]));

describe('publish checklist (single source)', () => {
  it('defines six items, each checked exactly once, and the server schema requires every key', () => {
    expect(PUBLISH_CHECKLIST_KEYS).toHaveLength(6);
    expect(PUBLISH_CHECKS.map((check) => check.key).sort()).toEqual([...PUBLISH_CHECKLIST_KEYS].sort());

    const confirmed = Object.fromEntries(PUBLISH_CHECKLIST_KEYS.map((key) => [key, true]));
    expect(PublishChecklistSchema.parse(confirmed)).toEqual(confirmed);
    for (const key of PUBLISH_CHECKLIST_KEYS) {
      expect(PublishChecklistSchema.safeParse({ ...confirmed, [key]: false }).success).toBe(false);
    }
    expect(PublishChecklistSchema.safeParse({ ...confirmed, extra: true }).success).toBe(false);
  });

  it('is complete only when every item is confirmed', () => {
    const checklist = emptyPublishChecklist();
    expect(isPublishChecklistComplete(checklist)).toBe(false);
    const confirmed = Object.fromEntries(PUBLISH_CHECKLIST_KEYS.map((key) => [key, true])) as typeof checklist;
    expect(isPublishChecklistComplete(confirmed)).toBe(true);
    expect(isPublishChecklistComplete({ ...confirmed, ageAppropriate: false })).toBe(false);
  });

  it('maps diagnostics to their items and never passes the manual age check', () => {
    const readiness = evaluatePublishReadiness(report([
      diagnostic('W_NO_OBJECTIVES', 'warning'),
      diagnostic('E_ANSWER_SHAPE', 'error'),
      diagnostic('E_ANSWER_REF_UNKNOWN', 'error'),
      diagnostic('E_REF_UNRESOLVED', 'error'),
    ]), 'rev-1');

    expect(readiness.current).toBe(true);
    expect(stateOf(readiness)).toEqual({
      outcomesReviewed: 'warn',
      answerKeysVerified: 'fail',
      accessibilityReviewed: 'pass',
      linksValid: 'fail',
      warningsAcknowledged: 'warn',
      ageAppropriate: 'manual',
    });
    expect(readiness.items.find((item) => item.key === 'answerKeysVerified')?.diagnostics).toHaveLength(2);
    expect(readiness.passing).toBe(1);
    expect(readiness.total).toBe(6);
  });

  it('passes every automatic item on a clean report for the current revision', () => {
    const readiness = evaluatePublishReadiness(report([]), 'rev-1');
    expect(readiness.passing).toBe(5);
    expect(stateOf(readiness).ageAppropriate).toBe('manual');
  });

  it('shows nothing as passing when the report belongs to another revision or is missing', () => {
    for (const readiness of [
      evaluatePublishReadiness(report([]), 'rev-2'),
      evaluatePublishReadiness(null, 'rev-1'),
      evaluatePublishReadiness(report([]), null),
    ]) {
      expect(readiness.current).toBe(false);
      expect(readiness.passing).toBe(0);
      expect(new Set(readiness.items.filter((item) => item.kind !== 'manual').map((item) => item.state))).toEqual(new Set(['unverified']));
    }
  });
});
