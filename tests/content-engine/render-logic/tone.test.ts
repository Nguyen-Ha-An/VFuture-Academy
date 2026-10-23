import { describe, it, expect } from 'vitest';
import { blockFrame, buttonClass, calloutTone, fieldClass, partState, questionTone, resultTone, stateTagClass, type CalloutVariant, type QuestionState } from '@/content-engine/render/tone';

const BORDER_TOKEN = /(?:^|\s)border-(?:border|input|primary|destructive|success-border|warning-border|info-border)(?:\s|$)/;
const STATES: QuestionState[] = ['correct', 'incorrect', 'selected', 'idle'];

describe('content-engine tone maps', () => {
  it('maps results onto bench tones, with manual grading pending', () => {
    expect(resultTone('correct')).toBe('signal');
    expect(resultTone('incorrect')).toBe('fault');
    expect(resultTone('partial')).toBe('pending');
    expect(resultTone('pending_manual')).toBe('pending');
    expect(resultTone('incomplete')).toBe('neutral');
    expect(resultTone('self_assessed')).toBe('neutral');
  });

  it('gives every answer, field and callout tone a border colour token', () => {
    for (const state of STATES) { expect(questionTone(state)).toMatch(BORDER_TOKEN); expect(fieldClass(state)).toMatch(BORDER_TOKEN); }
    for (const variant of ['info', 'tip', 'warning', 'danger', 'note'] as CalloutVariant[]) expect(calloutTone(variant)).toMatch(BORDER_TOKEN);
    expect(questionTone('selected')).toBe('border-primary');
    expect(fieldClass()).toContain('border-input');
    expect(calloutTone('info')).toBe('border-info-border bg-info text-info-foreground');
    expect(calloutTone('danger')).toContain('bg-destructive/10');
  });

  it('keeps graded parts ahead of the selection', () => {
    expect(partState('correct', true)).toBe('correct');
    expect(partState('incorrect')).toBe('incorrect');
    expect(partState(undefined, true)).toBe('selected');
    expect(partState('missing')).toBe('idle');
  });

  it('renders cards at depth 0 and flat hairline sections when nested', () => {
    expect(blockFrame(0)).toBe('rounded-lg border border-border bg-card p-4');
    expect(blockFrame()).toBe(blockFrame(0));
    expect(blockFrame(1)).toBe('border-t border-border pt-4');
    expect(blockFrame(3)).toBe(blockFrame(1));
  });

  it('pairs tag fills with their foregrounds and buttons with 44px targets', () => {
    expect(stateTagClass('signal')).toContain('bg-success text-success-foreground');
    expect(stateTagClass('pending')).toContain('bg-warning text-warning-foreground');
    expect(stateTagClass('fault')).toContain('bg-destructive/10 text-destructive');
    expect(stateTagClass('info')).toContain('bg-info text-info-foreground');
    expect(stateTagClass('neutral')).toContain('bg-muted text-muted-foreground');
    expect(buttonClass.primary).toMatch(/\bbg-primary\b.*\btext-primary-foreground\b/);
    for (const cls of Object.values(buttonClass)) expect(cls).toContain('min-h-11');
  });
});
