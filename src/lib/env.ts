import 'server-only';

import { z } from 'zod';

const environmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_CONTACT_EMAIL: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.email().optional(),
  ),
});

export type Environment = z.infer<typeof environmentSchema>;

function formatEnvironmentError(error: z.ZodError) {
  const names = [...new Set(error.issues.map((issue) => issue.path.join('.')))].join(', ');
  return `Missing or invalid environment variables: ${names}`;
}

/**
 * Parses application-server values without ever including a secret value in
 * an error message. Browser code must use env-client.ts; scripts validate
 * their direct-database credential in scripts/env.ts.
 */
export function readEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) throw new Error(formatEnvironmentError(result.error));
  return result.data;
}

let runtimeEnvironmentValidated = false;

/** Validates deployment-only invariants once, when request-time services start being used. */
export function assertRuntimeEnvironment(source: NodeJS.ProcessEnv = process.env): void {
  const memoizedSource = source === process.env;
  if (memoizedSource && runtimeEnvironmentValidated) return;

  const hasTrustedProxy = source.TRUSTED_PROXY?.trim() === '1';
  const hasCookieSecret = Boolean(source.RATE_LIMIT_COOKIE_SECRET?.trim());
  const isRuntime = Boolean(source.NEXT_RUNTIME?.trim())
    || source.NEXT_PHASE !== 'phase-production-build';
  if (source.NODE_ENV === 'production' && isRuntime && !hasTrustedProxy && !hasCookieSecret) {
    throw new Error('Production rate limiting requires TRUSTED_PROXY=1 or RATE_LIMIT_COOKIE_SECRET');
  }
  // A build-only exemption must not suppress validation if the same process
  // subsequently starts evaluating request-time code with NEXT_RUNTIME set.
  if (memoizedSource && (source.NODE_ENV !== 'production' || isRuntime)) {
    runtimeEnvironmentValidated = true;
  }
}

let cachedEnvironment: Environment | undefined;

function getEnvironment(): Environment {
  assertRuntimeEnvironment();
  cachedEnvironment ??= readEnvironment();
  return cachedEnvironment;
}

// Intentionally server-only and lazy: imports during builds do not evaluate
// deployment configuration, while the first request-time property read does.
export const env = new Proxy({} as Environment, {
  get(_target, property) {
    return getEnvironment()[property as keyof Environment];
  },
  ownKeys() {
    return Reflect.ownKeys(getEnvironment());
  },
  getOwnPropertyDescriptor(_target, property) {
    const value = getEnvironment()[property as keyof Environment];
    return { configurable: true, enumerable: true, value };
  },
});
