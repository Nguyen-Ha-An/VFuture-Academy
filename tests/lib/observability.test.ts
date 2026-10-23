import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  readOptionalSentryDsn,
  reportError,
  setErrorSink,
  type ErrorReport,
} from '@/lib/observability';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('error reporting', () => {
  it('returns a correlation id and sends the original error with bounded context to a pluggable sink', () => {
    const reports: ErrorReport[] = [];
    const restore = setErrorSink((report) => { reports.push(report); });
    const error = new Error('database unavailable');

    try {
      const correlationId = reportError(error, { area: 'api', method: 'GET', pathname: '/api/v1/example' });

      expect(correlationId).toMatch(/^[0-9a-f-]{36}$/);
      expect(reports).toEqual([expect.objectContaining({
        correlationId,
        error,
        context: { area: 'api', method: 'GET', pathname: '/api/v1/example' },
      })]);
    } finally {
      restore();
    }
  });

  it('preserves a caller-supplied correlation id', () => {
    const sink = vi.fn();
    const restore = setErrorSink(sink);

    try {
      expect(reportError(new Error('failure'), {
        area: 'worker', correlationId: 'request-correlation-id',
      })).toBe('request-correlation-id');
      expect(sink).toHaveBeenCalledWith(expect.objectContaining({
        correlationId: 'request-correlation-id',
      }));
    } finally {
      restore();
    }
  });

  it('reads only valid HTTPS Sentry DSNs and does not initialize Sentry', () => {
    expect(readOptionalSentryDsn({ SENTRY_DSN: 'https://public@example.ingest.sentry.io/123' }))
      .toBe('https://public@example.ingest.sentry.io/123');
    expect(readOptionalSentryDsn({ SENTRY_DSN: 'http://example.test/123' })).toBeUndefined();
    expect(readOptionalSentryDsn({ SENTRY_DSN: 'not-a-url' })).toBeUndefined();
    expect(readOptionalSentryDsn({})).toBeUndefined();
  });

  it('uses only the statically public DSN in a browser context', () => {
    vi.stubEnv('SENTRY_DSN', 'https://server@example.ingest.sentry.io/123');
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@example.ingest.sentry.io/456');
    vi.stubGlobal('window', {});

    expect(readOptionalSentryDsn()).toBe('https://public@example.ingest.sentry.io/456');
  });

  it('redacts secret-shaped values from the default console sink', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reportError(new Error('password=hunter2'), {
      area: 'api',
      authorization: 'Bearer secret-token',
    });

    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('secret-token');
  });

  it.each([
    ['Authorization: Bearer test-access-token', 'test-access-token'],
    ['Authorization=Basic dGVzdDpwYXNzd29yZA==', 'dGVzdDpwYXNzd29yZA=='],
    ['Connection failed: postgresql://test-user:test-password@db.example.test/app', 'test-password'],
    ['HTTP failure: https://test-user:test-password@example.test/path', 'test-password'],
    ['{"access_token":"test-access-token"}', 'test-access-token'],
    ['password="test password with spaces"', 'test password with spaces'],
  ])('redacts credentials in error messages and nested string context: %s', (message, secret) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    reportError(new Error(message), { area: 'api', details: { message } });
    const serialized = JSON.stringify(log.mock.calls);
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).not.toContain(secret);
  });
});
