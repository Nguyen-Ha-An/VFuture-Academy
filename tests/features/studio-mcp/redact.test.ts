import { describe, expect, it } from 'vitest';

import { pointsIntoRedaction, redactItemDocument } from '@/features/studio-mcp/data/redact';

describe('MCP reader document', () => {
  it.each(['none', 'after_submit', 'per_question'])('keeps only the quiz settings feedback policy %s', feedback => {
    const quiz = {
      type: 'quiz', id: 'practice', settings: { feedback }, questions: [
        { type: 'single_choice', settings: { feedback }, options: [{ id: 'a', feedback }] },
      ],
    };
    const expected = { ...quiz, questions: [{ type: 'single_choice', settings: {}, options: [{ id: 'a' }] }] };
    const result = redactItemDocument(quiz);
    expect(result.document).toEqual(expected);
    expect(pointsIntoRedaction('/settings/feedback', result.redactedPaths)).toBe(false);
    expect(pointsIntoRedaction('/questions/0/options/0/feedback', result.redactedPaths)).toBe(true);
    for (const invalid of ['private feedback', { correctAnswer: 'hidden' }]) {
      const rejected = redactItemDocument({ ...quiz, settings: { feedback: invalid } });
      expect(rejected.document).toMatchObject({ settings: {} });
      expect(pointsIntoRedaction('/settings/feedback', rejected.redactedPaths)).toBe(true);
      expect(JSON.stringify(rejected.document)).not.toMatch(/private feedback|hidden/);
    }
  });

  it('removes nested answer material before pointer access and obscures position answers', () => {
    const source = {
      id: 'lesson-a',
      blocks: [{
        id: 'quiz-a', type: 'quiz', questions: [
          {
            id: 'order-a', type: 'ordering',
            items: [{ id: 'first' }, { id: 'second' }],
            correctAnswer: ['first', 'second'],
            settings: { feedback: { correctAnswer: 'hidden' } },
            grading: { optionFeedback: { a: 'hidden grader feedback' }, arbitrary: 'hidden grader data' },
          },
          {
            id: 'match-a', type: 'matching',
            right: [{ id: 'one' }, { id: 'two' }],
            explanation: 'hidden',
          },
        ],
      }],
    };

    const result = redactItemDocument(source);
    const document = result.document as typeof source;
    const [order, match] = document.blocks[0].questions;
    expect(JSON.stringify(document)).not.toContain('hidden');
    expect(order.items!.map((item) => item.id).sort()).toEqual(['first', 'second']);
    expect(match.right!.map((item) => item.id).sort()).toEqual(['one', 'two']);
    expect(pointsIntoRedaction('/blocks/0/questions/0/correctAnswer', result.redactedPaths)).toBe(true);
    expect(pointsIntoRedaction('/blocks/0/questions/0/settings/feedback/correctAnswer', result.redactedPaths)).toBe(true);
    expect(pointsIntoRedaction('/blocks/0/questions/0/items/0', result.redactedPaths)).toBe(true);
    expect(pointsIntoRedaction('/blocks/0/questions/0/id', result.redactedPaths)).toBe(false);
    expect(source.blocks[0].questions[0].items!.map((item) => item.id)).toEqual(['first', 'second']);

    // Repeated reads cannot use a public item id to reconstruct the order.
    const observed = new Set(Array.from({ length: 32 }, () => {
      const next = redactItemDocument(source).document as typeof source;
      return next.blocks[0].questions[0].items!.map((item) => item.id).join(',');
    }));
    expect(observed.size).toBe(2);
  });
});
