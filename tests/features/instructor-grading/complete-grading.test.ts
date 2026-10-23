import { describe, expect, it } from 'vitest';

import {
  CompletionContractError,
  completeGradingPath,
  completeExamGrading,
  completionErrorCode,
  isManualGradingOpen,
  isRecoverableCompletionError,
  needsLegacyRelease,
  parseCompletedExamAttempt,
  parseManualGradingProgress,
} from '@/features/instructor-grading/complete-grading';
import { WorkspaceApiError } from '@/features/studio/ui/client';

const ATTEMPT = 'attempt-1';
const complete = {
  attemptId: ATTEMPT,
  status: 'graded',
  points: 11,
  maxPoints: 12,
  percent: 91.67,
  releasedAt: null,
  resultAvailableAt: '2026-09-07T04:10:00.000Z',
};

describe('parseCompletedExamAttempt', () => {
  it('accepts the published DTO under an attempt wrapper and as a bare attempt', () => {
    const wrapped = parseCompletedExamAttempt({ attempt: complete, transitioned: true }, ATTEMPT);
    expect(wrapped).toMatchObject({ status: 'graded', points: 11, maxPoints: 12, percent: 91.67, transitioned: true });
    expect(wrapped?.resultAvailableAt).toBe('2026-09-07T04:10:00.000Z');
    expect(parseCompletedExamAttempt(complete, ATTEMPT)).toMatchObject({ status: 'graded', transitioned: true });
  });

  it('reports an already-complete attempt as authoritative but not this grader transition', () => {
    expect(parseCompletedExamAttempt({ attempt: complete, transitioned: false }, ATTEMPT))
      .toMatchObject({ status: 'graded', transitioned: false });
  });

  it('ignores unknown DTO fields so the contract can grow', () => {
    expect(parseCompletedExamAttempt({ attempt: { ...complete, gradedBy: 'x', extra: { deep: 1 } } }, ATTEMPT))
      .toMatchObject({ status: 'graded', points: 11 });
  });

  it('accepts snake_case aliases for the availability and total fields', () => {
    expect(parseCompletedExamAttempt({
      attempt: {
        attempt_id: ATTEMPT, status: 'graded', points: 4, max_points: 4, percent: 100,
        result_available_at: '2026-09-07T04:10:00.000Z', released_at: null,
      },
    }, ATTEMPT)).toMatchObject({ attemptId: ATTEMPT, maxPoints: 4, percent: 100 });
  });

  it('rejects a status other than graded even when an availability timestamp is present', () => {
    for (const status of ['pending_manual', 'expired', 'submitted', 'in_progress', 'weird', '', null, 42]) {
      expect(parseCompletedExamAttempt({ attempt: { ...complete, status } }, ATTEMPT)).toBeNull();
    }
  });

  it('rejects a missing or unparseable availability timestamp', () => {
    for (const resultAvailableAt of [null, undefined, '', 'not-a-date', 12345, {}]) {
      expect(parseCompletedExamAttempt({ attempt: { ...complete, resultAvailableAt } }, ATTEMPT)).toBeNull();
    }
  });

  it('rejects absent or non-finite totals', () => {
    expect(parseCompletedExamAttempt({ attempt: { ...complete, points: null } }, ATTEMPT)).toBeNull();
    expect(parseCompletedExamAttempt({ attempt: { ...complete, maxPoints: null } }, ATTEMPT)).toBeNull();
    expect(parseCompletedExamAttempt({ attempt: { ...complete, percent: null } }, ATTEMPT)).toBeNull();
    expect(parseCompletedExamAttempt({ attempt: { ...complete, points: Number.NaN } }, ATTEMPT)).toBeNull();
    expect(parseCompletedExamAttempt({ attempt: { ...complete, percent: Number.POSITIVE_INFINITY } }, ATTEMPT)).toBeNull();
    const { percent: _percent, ...withoutPercent } = complete;
    expect(parseCompletedExamAttempt({ attempt: withoutPercent }, ATTEMPT)).toBeNull();
  });

  it('rejects impossible score ranges', () => {
    expect(parseCompletedExamAttempt({ attempt: { ...complete, points: -1 } }, ATTEMPT)).toBeNull();
    expect(parseCompletedExamAttempt({ attempt: { ...complete, maxPoints: -1 } }, ATTEMPT)).toBeNull();
    expect(parseCompletedExamAttempt({ attempt: { ...complete, points: 13, maxPoints: 12 } }, ATTEMPT)).toBeNull();
    expect(parseCompletedExamAttempt({ attempt: { ...complete, percent: -0.1 } }, ATTEMPT)).toBeNull();
    expect(parseCompletedExamAttempt({ attempt: { ...complete, percent: 100.1 } }, ATTEMPT)).toBeNull();
  });

  it('accepts a zero-point attempt, which is a legitimate completed result', () => {
    expect(parseCompletedExamAttempt({ attempt: { ...complete, points: 0, maxPoints: 0, percent: 0 } }, ATTEMPT))
      .toMatchObject({ points: 0, maxPoints: 0, percent: 0 });
  });

  it('refuses a response describing a different attempt', () => {
    expect(parseCompletedExamAttempt({ attempt: { ...complete, attemptId: 'other-attempt' } }, ATTEMPT)).toBeNull();
  });

  it('accepts a DTO that omits the id, since the request already addressed one attempt', () => {
    const { attemptId: _attemptId, ...withoutId } = complete;
    expect(parseCompletedExamAttempt({ attempt: withoutId }, ATTEMPT)).toMatchObject({ attemptId: null, status: 'graded' });
  });

  it('rejects non-object payloads', () => {
    for (const value of [null, undefined, 'graded', 7, [complete]]) {
      expect(parseCompletedExamAttempt(value, ATTEMPT)).toBeNull();
    }
  });
});

describe('completeExamGrading', () => {
  function respond(body: unknown, status = 200) {
    return async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }

  it('posts an empty body to the published path and returns the final state', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      calls.push([String(input), init]);
      return respond({ data: { attempt: complete, transitioned: true } })();
    }) as typeof fetch;
    await expect(completeExamGrading(ATTEMPT)).resolves.toMatchObject({ status: 'graded', transitioned: true });
    expect(calls[0][0]).toBe(completeGradingPath(ATTEMPT));
    expect(calls[0][1]?.method).toBe('POST');
    expect(calls[0][1]?.body).toBe('{}');
  });

  it('raises a recoverable contract error on a malformed 200 instead of reporting success', async () => {
    globalThis.fetch = respond({ data: { attempt: { ...complete, resultAvailableAt: null } } }) as typeof fetch;
    await expect(completeExamGrading(ATTEMPT)).rejects.toBeInstanceOf(CompletionContractError);
    globalThis.fetch = respond({ data: { attempt: { ...complete, status: 'expired' } } }) as typeof fetch;
    await expect(completeExamGrading(ATTEMPT)).rejects.toBeInstanceOf(CompletionContractError);
    globalThis.fetch = respond({ data: { attempt: { ...complete, points: null } } }) as typeof fetch;
    await expect(completeExamGrading(ATTEMPT)).rejects.toBeInstanceOf(CompletionContractError);
    globalThis.fetch = respond({ data: { attempt: { ...complete, attemptId: 'someone-else' } } }) as typeof fetch;
    await expect(completeExamGrading(ATTEMPT)).rejects.toBeInstanceOf(CompletionContractError);
  });

  it('escapes the attempt id in the request path', () => {
    expect(completeGradingPath('a/b?c')).toBe('/api/v1/studio/exams/attempts/a%2Fb%3Fc/complete-grading');
  });
});

describe('recoverable completion errors', () => {
  it('treats the documented conflict codes and a contract error as recoverable', () => {
    for (const code of ['MANUAL_GRADING_INCOMPLETE', 'GRADING_CONFLICT', 'ATTEMPT_NOT_ACTIVE', 'INVALID_GRADE', 'LEGACY_RESULT_UNRELEASED']) {
      expect(isRecoverableCompletionError(new WorkspaceApiError(code, code))).toBe(true);
    }
    expect(isRecoverableCompletionError(new CompletionContractError())).toBe(true);
    expect(isRecoverableCompletionError(new WorkspaceApiError('FORBIDDEN', 'no'))).toBe(false);
    expect(isRecoverableCompletionError(new Error('offline'))).toBe(false);
  });

  it('exposes the error code only for API errors', () => {
    expect(completionErrorCode(new WorkspaceApiError('GRADING_CONFLICT', 'x'))).toBe('GRADING_CONFLICT');
    expect(completionErrorCode(new Error('x'))).toBeNull();
  });
});

describe('parseManualGradingProgress', () => {
  it('reads the server completion gate', () => {
    expect(parseManualGradingProgress({ manualGrading: { total: 3, scored: 2, outstanding: ['s/q3'], complete: false } }))
      .toEqual({ total: 3, scored: 2, outstanding: ['s/q3'], complete: false });
  });

  it('returns null when the field is absent so the caller can fall back', () => {
    expect(parseManualGradingProgress({})).toBeNull();
    expect(parseManualGradingProgress({ manualGrading: { total: 'x', scored: 1 } })).toBeNull();
    expect(parseManualGradingProgress(null)).toBeNull();
  });

  it('drops non-string outstanding ids and never reports complete on a non-true value', () => {
    expect(parseManualGradingProgress({ manualGrading: { total: 1, scored: 0, outstanding: ['a', 3, null], complete: 'yes' } }))
      .toEqual({ total: 1, scored: 0, outstanding: ['a'], complete: false });
  });
});

describe('result availability axes', () => {
  it('separates manual grading from finalization', () => {
    expect(isManualGradingOpen('pending_manual')).toBe(true);
    expect(isManualGradingOpen('graded')).toBe(false);
    expect(isManualGradingOpen(undefined)).toBe(false);
  });

  it('marks only historical graded attempts with neither timestamp as needing legacy release', () => {
    expect(needsLegacyRelease({ status: 'graded', resultAvailableAt: null, releasedAt: null })).toBe(true);
    expect(needsLegacyRelease({ status: 'graded', resultAvailableAt: '2026-09-07T00:00:00.000Z', releasedAt: null })).toBe(false);
    expect(needsLegacyRelease({ status: 'graded', resultAvailableAt: null, releasedAt: '2026-09-01T00:00:00.000Z' })).toBe(false);
    expect(needsLegacyRelease({ status: 'pending_manual', resultAvailableAt: null, releasedAt: null })).toBe(false);
    for (const status of ['expired', 'in_progress', 'submitted', 'unknown', undefined]) {
      expect(needsLegacyRelease({ status, resultAvailableAt: null, releasedAt: null })).toBe(false);
    }
  });
});
