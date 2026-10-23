import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  excludeInternalContent,
  internalContentFingerprint,
  internalContentPolicy,
  isInternalContentId,
  withoutInternalContent,
} from '@/lib/internal-content';

type Call = [string, string, string];
function query() {
  const calls: Call[] = [];
  const value = { calls, not(column: string, operator: string, operand: string) { calls.push([column, operator, operand]); return value; } };
  return value;
}

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

afterEach(() => vi.unstubAllEnvs());

describe('internal content policy', () => {
  it('hides nothing while the flag is unset or not exactly 1', () => {
    for (const flag of [undefined, '', '0', 'true', 'yes']) {
      const policy = internalContentPolicy(env(flag === undefined ? {} : { HIDE_INTERNAL_CONTENT: flag }));
      expect(policy.hidden).toBe(false);
      expect(isInternalContentId('recovery-course', policy)).toBe(false);
    }
    const rows = [{ id: 'recovery-course' }];
    expect(withoutInternalContent(rows, (row) => row.id, internalContentPolicy(env({})))).toEqual(rows);
  });

  it('hides the recovery prefix and listed ids when the flag is 1', () => {
    const policy = internalContentPolicy(env({ HIDE_INTERNAL_CONTENT: ' 1 ', INTERNAL_CONTENT_IDS: 'schema-stress, other-fixture' }));
    expect(policy.hidden).toBe(true);
    expect(isInternalContentId('recovery-course', policy)).toBe(true);
    expect(isInternalContentId('schema-stress', policy)).toBe(true);
    expect(isInternalContentId('other-fixture', policy)).toBe(true);
    expect(isInternalContentId('ai-foundations', policy)).toBe(false);
    expect(isInternalContentId('pre-recovery-course', policy)).toBe(false);
    expect(withoutInternalContent(
      [{ id: 'ai-foundations' }, { id: 'recovery-course' }, { id: 'schema-stress' }],
      (row) => row.id,
      policy,
    )).toEqual([{ id: 'ai-foundations' }]);
  });

  it('ignores listed ids that fail the content id pattern', () => {
    const policy = internalContentPolicy(env({
      HIDE_INTERNAL_CONTENT: '1',
      INTERNAL_CONTENT_IDS: 'valid-id,,Upper,has space,x),-leading,a'.concat('b'.repeat(64)),
    }));
    expect([...policy.ids]).toEqual(['valid-id']);
  });

  it('reads process.env by default', () => {
    expect(isInternalContentId('recovery-course')).toBe(false);
    vi.stubEnv('HIDE_INTERNAL_CONTENT', '1');
    expect(isInternalContentId('recovery-course')).toBe(true);
  });

  it('fingerprints the policy stably for cache keys', () => {
    expect(internalContentFingerprint(internalContentPolicy(env({})))).toBe('internal:shown');
    const left = internalContentPolicy(env({ HIDE_INTERNAL_CONTENT: '1', INTERNAL_CONTENT_IDS: 'b-id,a-id' }));
    const right = internalContentPolicy(env({ HIDE_INTERNAL_CONTENT: '1', INTERNAL_CONTENT_IDS: 'a-id,b-id' }));
    expect(internalContentFingerprint(left)).toBe('internal:hidden:a-id,b-id');
    expect(internalContentFingerprint(right)).toBe(internalContentFingerprint(left));
  });
});

describe('excludeInternalContent', () => {
  it('leaves the query untouched while the flag is off', () => {
    const builder = query();
    expect(excludeInternalContent(builder, internalContentPolicy(env({ INTERNAL_CONTENT_IDS: 'a-id' })))).toBe(builder);
    expect(builder.calls).toEqual([]);
  });

  it('adds the prefix predicate, plus a sorted id list when ids are configured', () => {
    const prefixOnly = query();
    excludeInternalContent(prefixOnly, internalContentPolicy(env({ HIDE_INTERNAL_CONTENT: '1' })));
    expect(prefixOnly.calls).toEqual([['id', 'like', 'recovery-%']]);

    const withIds = query();
    excludeInternalContent(withIds, internalContentPolicy(env({ HIDE_INTERNAL_CONTENT: '1', INTERNAL_CONTENT_IDS: 'b-id,a-id' })), 'course_id');
    expect(withIds.calls).toEqual([['course_id', 'like', 'recovery-%'], ['course_id', 'in', '(a-id,b-id)']]);
  });
});
