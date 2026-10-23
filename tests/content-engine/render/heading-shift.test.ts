import { describe, it, expect } from 'vitest';
import { headingShift, headingTag, minHeadingLevel, sectionLevelFor } from '@/content-engine/render/heading-shift';
import { plural, tr } from '@/content-engine/render/strings';

const h = (level: number) => ({ type: 'heading', level, content: [] });

describe('heading shift', () => {
  it('finds the shallowest heading through container children, steps and items', () => {
    expect(minHeadingLevel([{ type: 'paragraph' }])).toBeNull();
    expect(minHeadingLevel([h(3), { type: 'callout', blocks: [h(2)] }])).toBe(2);
    expect(minHeadingLevel([h(4), { type: 'stepper', steps: [{ blocks: [h(3)] }] }, { type: 'tabs', items: [{ blocks: [{ type: 'reveal', blocks: [h(1)] }] }] }])).toBe(1);
  });

  it('moves the shallowest heading to one below the owner and caps at h6', () => {
    expect(headingShift(1, 1)).toBe(1);
    expect(headingShift(1, 2)).toBe(0);
    expect(headingShift(2, 1)).toBe(2);
    // A lesson that starts at h3 under the page h1 is promoted, so the outline never skips a level.
    expect(headingShift(1, 3)).toBe(-1);
    expect(headingTag(3 + headingShift(1, 3))).toBe('h2');
    expect(headingTag(4 + headingShift(1, 3))).toBe('h3');
    expect(headingShift(1, null)).toBe(0);
    expect(headingTag(4 + 3)).toBe('h6');
  });

  it('places container titles after the owner and the authored headings', () => {
    expect(sectionLevelFor(1, false)).toBe(2);
    expect(sectionLevelFor(1, true)).toBe(3);
    expect(sectionLevelFor(6, true)).toBe(6);
  });
});

describe('engine strings', () => {
  it('pluralizes per locale and fills placeholders', () => {
    expect(plural('en', 1, { one: '# question', other: '# questions' })).toBe('1 question');
    expect(plural('en', 0, { one: '# question', other: '# questions' })).toBe('0 questions');
    expect(plural('vi', 1, { one: '# câu', other: '# câu hỏi' })).toBe('1 câu hỏi');
    expect(tr('en', { vi: 'đạt ≥ {percent}%', en: 'pass ≥ {percent}%' }, { percent: 70 })).toBe('pass ≥ 70%');
  });
});
