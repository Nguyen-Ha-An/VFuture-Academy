import { describe, expect, it } from 'vitest';
import { deadlineToLocal, deadlineToUtc } from '@/features/instructor-grading/schedule-time';

describe('school deadline time zone', () => {
  it('round trips across a UTC day boundary independent of browser time zone', () => {
    expect(deadlineToUtc('2026-11-05T00:30')).toBe('2026-11-04T17:30:00.000Z');
    expect(deadlineToLocal('2026-11-04T17:30:00.000Z')).toBe('2026-11-05T00:30');
  });
  it('represents optional and invalid deadlines without displaying a date', () => {
    expect(deadlineToUtc('')).toBeNull();
    expect(deadlineToLocal(null)).toBe('');
    expect(deadlineToLocal('invalid')).toBe('');
  });
});
