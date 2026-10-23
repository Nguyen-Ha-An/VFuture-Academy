export type ErrorContext = Readonly<Record<string, unknown> & { correlationId?: string }>;

export type ErrorReport = {
  correlationId: string;
  error: unknown;
  context: Readonly<Record<string, unknown>>;
  occurredAt: string;
  sentryDsn?: string;
};

export type ErrorSink = (report: ErrorReport) => void | Promise<void>;

const SENSITIVE_KEY = /(pass(word)?|secret|token|key|credential|cookie|authorization|session|refresh)/i;
const SENSITIVE_ASSIGNMENT = /\b((?:access[-_]?|refresh[-_]?)?token|password|pass|secret|api[-_]?key|authorization|cookie|session|credential)["']?\s*([=:])\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&]+)/gi;
const AUTHORIZATION_VALUE = /\b(authorization["']?\s*[:=]\s*["']?)(?:Bearer|Basic)\s+[^\s,"';]+/gi;
const URL_CREDENTIALS = /\b([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi;

function redactString(value: string) {
  return value
    .replace(URL_CREDENTIALS, '$1[REDACTED]@')
    .replace(AUTHORIZATION_VALUE, '$1[REDACTED]')
    .replace(SENSITIVE_ASSIGNMENT, '$1$2[REDACTED]');
}

function sanitize(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= 4) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, seen, depth + 1));
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, nested]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitize(nested, seen, depth + 1),
  ]));
}

function errorSummary(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: redactString(error.message) };
  return { name: 'UnknownError', value: sanitize(error) };
}

const consoleSink: ErrorSink = (report) => {
  console.error(
    `[error:${report.correlationId}]`,
    errorSummary(report.error),
    sanitize(report.context),
  );
};

let activeSink: ErrorSink = consoleSink;

function createCorrelationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** Reads a future Sentry sink's DSN without importing or initializing an SDK. */
export function readOptionalSentryDsn(
  source?: Readonly<Record<string, string | undefined>>,
) {
  // NEXT_PUBLIC_* must be referenced statically so Next can inline it in the
  // client error-boundary bundle. The server-only value is never read there.
  const publicDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const runtimeDsn = typeof window === 'undefined'
    ? process.env.SENTRY_DSN ?? publicDsn
    : publicDsn;
  const value = source
    ? source.SENTRY_DSN ?? source.NEXT_PUBLIC_SENTRY_DSN
    : runtimeDsn;
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Installs an error transport and returns a scoped restore function. */
export function setErrorSink(sink: ErrorSink) {
  const previous = activeSink;
  activeSink = sink;
  return () => {
    if (activeSink === sink) activeSink = previous;
  };
}

/** Reports an unexpected failure and returns the safe ID that may be shown to callers. */
export function reportError(error: unknown, context: ErrorContext) {
  const { correlationId: requestedId, ...details } = context;
  const correlationId = requestedId ?? createCorrelationId();
  const sentryDsn = readOptionalSentryDsn();
  const report: ErrorReport = {
    correlationId,
    error,
    context: details,
    occurredAt: new Date().toISOString(),
    ...(sentryDsn ? { sentryDsn } : {}),
  };
  try {
    const pending = activeSink(report);
    if (pending) {
      void Promise.resolve(pending).catch(() => {
        console.error(`[error:${correlationId}] Error sink rejected the report`);
      });
    }
  } catch {
    console.error(`[error:${correlationId}] Error sink rejected the report`);
  }
  return correlationId;
}
