import { describe, expect, it } from 'vitest';
import { differingOwnAnswers } from '@/features/exams/ui/answer-recovery';

describe('own-answer recovery comparison', () => {
  it('does not call an already accepted response excluded when its acknowledgement was lost', () => {
    expect(differingOwnAnswers({ essay: 'My response', group: { second: 'b', first: 'a' } }, { group: { first: 'a', second: 'b' }, essay: 'My response' })).toEqual({});
  });

  it('copies only differing own responses, never unrelated server data', () => {
    expect(differingOwnAnswers({ essay: 'Unsaved revision', choice: 'a' }, { essay: 'Older saved response', choice: 'a', otherQuestion: 'Not in the local response map' })).toEqual({ essay: 'Unsaved revision' });
  });

  it('preserves a clearing edit and canonicalizes nested undefined without altering the original', () => {
    const local = { group: { first: undefined, second: 'Retained text' } };
    expect(differingOwnAnswers(local, { group: { first: 'Previously saved', second: 'Retained text' } })).toEqual({ group: { first: null, second: 'Retained text' } });
    expect(local.group.first).toBeUndefined();
  });

  it('keeps the recovery copy independent from later edits or a new attempt', () => {
    const local = { group: { first: 'Original unsaved text' } };
    const copy = differingOwnAnswers(local, {});
    local.group.first = 'Later text';
    expect(copy).toEqual({ group: { first: 'Original unsaved text' } });
    expect(differingOwnAnswers({ unanswered: undefined }, {})).toEqual({});
  });
});
