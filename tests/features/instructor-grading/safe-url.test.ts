import { describe, expect, it } from 'vitest';

import { safeHttpsUrl, safeInternalHref } from '@/features/instructor-grading/safe-url';

describe('safeHttpsUrl', () => {
  it('accepts https and rejects everything else', () => {
    expect(safeHttpsUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHttpsUrl('http://example.com')).toBeNull();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('/relative')).toBeNull();
    expect(safeHttpsUrl(42)).toBeNull();
  });
});

describe('safeInternalHref', () => {
  it('accepts every canonical assessment-workspace destination', () => {
    for (const path of ['/grading', '/grading/queue', '/grading/assessments', '/grading/reports']) {
      expect(safeInternalHref(path)).toBe(path);
    }
  });

  it('accepts pre-split sources that redirect to those destinations', () => {
    for (const path of ['/studio/grading', '/studio/assessments', '/studio/submissions', '/studio/exams',
      '/studio/analytics', '/admin/submissions', '/admin/exams', '/admin/analytics']) {
      expect(safeInternalHref(path)).toBe(path);
    }
  });

  it('keeps the query string so filters survive the round trip', () => {
    expect(safeInternalHref('/grading/queue?branchId=vinsmc&status=in_review'))
      .toBe('/grading/queue?branchId=vinsmc&status=in_review');
  });

  it('rejects off-origin destinations', () => {
    expect(safeInternalHref('https://evil.example')).toBeNull();
    expect(safeInternalHref('https://evil.example/grading/queue')).toBeNull();
    expect(safeInternalHref('//evil.example/grading/queue')).toBeNull();
    expect(safeInternalHref('javascript:alert(1)')).toBeNull();
    expect(safeInternalHref('\\\\evil.example')).toBeNull();
  });

  it('rejects internal paths that are not a grading queue, assessment list or report', () => {
    for (const path of ['/auth/signout', '/api/v1/studio/submissions', '/admin/roles', '/studio/library',
      '/grading/assignments/abc', '/grading/exams/abc', '/', '/gradingx']) {
      expect(safeInternalHref(path)).toBeNull();
    }
  });

  it('rejects encoded path separators that could smuggle another destination', () => {
    expect(safeInternalHref('/grading%2f..%2fauth/signout')).toBeNull();
    expect(safeInternalHref('/grading/queue%5c..')).toBeNull();
    expect(safeInternalHref('/studio/grading/../../auth/signout')).toBeNull();
  });

  it('drops a fragment rather than carrying it into the href', () => {
    expect(safeInternalHref('/grading/queue?a=1#frag')).toBe('/grading/queue?a=1');
  });

  it('rejects non-string and relative values', () => {
    expect(safeInternalHref(undefined)).toBeNull();
    expect(safeInternalHref(null)).toBeNull();
    expect(safeInternalHref(7)).toBeNull();
    expect(safeInternalHref('grading/queue')).toBeNull();
  });
});
