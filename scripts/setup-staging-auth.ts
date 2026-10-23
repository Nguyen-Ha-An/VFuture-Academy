import { pathToFileURL } from 'node:url';

import { loadEnvironment } from './load-env';
import { assertStagingStorageTarget } from './setup-staging-storage';

const RECOVERY_FIXTURE_DOMAIN = 'vfuture.example';
const PER_PAGE = 1_000;

export const STAGING_AUTH_ACCOUNT_VARIABLES = [
  ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD'],
  ['SEED_E2E_LEARNER_EMAIL', 'SEED_LEARNER_PASSWORD'],
  ['SEED_E2E_COMPLETED_LEARNER_EMAIL', 'SEED_COMPLETED_LEARNER_PASSWORD'],
  ['SEED_E2E_PRECOMPLETION_LEARNER_EMAIL', 'SEED_PRECOMPLETION_LEARNER_PASSWORD'],
  ['SEED_E2E_KEYBOARD_LEARNER_EMAIL', 'SEED_KEYBOARD_LEARNER_PASSWORD'],
  ['SEED_E2E_A11Y_LEARNER_EMAIL', 'SEED_A11Y_LEARNER_PASSWORD'],
  ['SEED_E2E_INSTRUCTOR_EMAIL', 'SEED_INSTRUCTOR_PASSWORD'],
  ['SEED_E2E_BRANCH_LEAD_EMAIL', 'SEED_BRANCH_LEAD_PASSWORD'],
  ['SEED_E2E_OTHER_BRANCH_LEARNER_EMAIL', 'SEED_OTHER_BRANCH_LEARNER_PASSWORD'],
] as const;

export type PreparedStagingAccount = { email: string; password: string };
export type ExistingStagingAuthUser = { email: string; recoveryFixture: boolean };
export type CreateStagingAuthUser = PreparedStagingAccount & {
  emailConfirm: true;
  appMetadata: { recovery_fixture: true };
};

export interface StagingAuthApi {
  listUsers(): Promise<ExistingStagingAuthUser[]>;
  createUser(input: CreateStagingAuthUser): Promise<void>;
}

export type StagingAuthEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SEED_DEV_PROJECT_REF: string;
  accounts: PreparedStagingAccount[];
};

export type StagingAuthSummary = { created: number; existing: number };

function isStrongPassword(password: string) {
  const characterClasses = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/]
    .filter(pattern => pattern.test(password)).length;
  return password.length >= 16 && characterClasses >= 3;
}

function isRecoveryFixtureEmail(email: string) {
  return /^recovery-[a-z0-9][a-z0-9._+-]*@vfuture\.example$/.test(email);
}

/** Validates every credential before an Auth API read or mutation can occur. */
export function validateStagingAuthAccounts(accounts: readonly PreparedStagingAccount[]): PreparedStagingAccount[] {
  if (accounts.length !== STAGING_AUTH_ACCOUNT_VARIABLES.length) {
    throw new Error('Exactly nine staging Auth fixture accounts are required.');
  }
  const normalized = accounts.map(account => ({
    email: account.email.trim().toLowerCase(),
    password: account.password,
  }));
  if (normalized.some(account => !isRecoveryFixtureEmail(account.email))) {
    throw new Error(`Staging Auth fixture emails must use recovery-* @${RECOVERY_FIXTURE_DOMAIN}.`);
  }
  if (normalized.some(account => !isStrongPassword(account.password))) {
    throw new Error('Every staging Auth fixture password must be strong.');
  }
  if (new Set(normalized.map(account => account.email)).size !== normalized.length) {
    throw new Error('Every staging Auth fixture email must be distinct.');
  }
  return normalized;
}

export function readStagingAuthEnvironment(source: Record<string, string | undefined> = process.env): StagingAuthEnvironment {
  if (source.SEED_ALLOW_PROD) throw new Error('Production override is not supported for staging Auth setup.');
  const apiUrl = source.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = source.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const projectRef = source.SEED_DEV_PROJECT_REF?.trim().toLowerCase();
  if (!apiUrl || !serviceKey || !projectRef) throw new Error('Missing or invalid staging Auth configuration.');
  assertStagingStorageTarget(apiUrl, projectRef);
  const accounts = validateStagingAuthAccounts(STAGING_AUTH_ACCOUNT_VARIABLES.map(([emailName, passwordName]) => ({
    email: source[emailName] ?? '',
    password: source[passwordName] ?? '',
  })));
  return {
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    SEED_DEV_PROJECT_REF: projectRef,
    accounts,
  };
}

/** Reuses only owned fixtures and rejects all ownership collisions before creating a user. */
export async function setupStagingAuth(api: StagingAuthApi, candidateAccounts: readonly PreparedStagingAccount[]): Promise<StagingAuthSummary> {
  const accounts = validateStagingAuthAccounts(candidateAccounts);
  let users: ExistingStagingAuthUser[];
  try {
    users = await api.listUsers();
  } catch {
    throw new Error('Staging Auth user lookup failed.');
  }
  const usersByEmail = new Map(users.map(user => [user.email.trim().toLowerCase(), user]));
  const collisions = accounts.filter(account => {
    const existing = usersByEmail.get(account.email);
    return existing && !existing.recoveryFixture;
  });
  if (collisions.length) {
    throw new Error('A staging Auth fixture email is already owned by another account; no users were created.');
  }

  const missing = accounts.filter(account => !usersByEmail.has(account.email));
  for (const account of missing) {
    try {
      await api.createUser({
        ...account,
        emailConfirm: true,
        appMetadata: { recovery_fixture: true },
      });
    } catch {
      throw new Error('Staging Auth account creation failed.');
    }
  }
  return { created: missing.length, existing: accounts.length - missing.length };
}

type AdminUsersResponse = { users?: Array<{ email?: unknown; app_metadata?: unknown }> };

export function createStagingAuthApi(supabaseUrl: string, serviceKey: string, request: typeof fetch = fetch): StagingAuthApi {
  const endpoint = `${new URL(supabaseUrl).origin}/auth/v1/admin/users`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

  async function call(url: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await request(url, {
        ...init,
        headers: { ...headers, ...(init?.headers ?? {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Staging Auth API request failed.');
    }
    if (!response.ok) throw new Error('Staging Auth API request failed.');
    return response;
  }

  return {
    async listUsers() {
      const users: ExistingStagingAuthUser[] = [];
      for (let page = 1; ; page += 1) {
        const response = await call(`${endpoint}?page=${page}&per_page=${PER_PAGE}`);
        let payload: AdminUsersResponse;
        try { payload = await response.json() as AdminUsersResponse; }
        catch { throw new Error('Staging Auth API response was invalid.'); }
        if (!Array.isArray(payload.users)) throw new Error('Staging Auth API response was invalid.');
        for (const user of payload.users) {
          if (typeof user.email !== 'string') continue;
          const metadata = typeof user.app_metadata === 'object' && user.app_metadata !== null
            ? user.app_metadata as Record<string, unknown>
            : {};
          users.push({ email: user.email, recoveryFixture: metadata.recovery_fixture === true });
        }
        if (payload.users.length < PER_PAGE) break;
      }
      return users;
    },
    async createUser(input) {
      await call(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          email_confirm: input.emailConfirm,
          app_metadata: input.appMetadata,
        }),
      });
    },
  };
}

async function main() {
  loadEnvironment();
  const environment = readStagingAuthEnvironment();
  const result = await setupStagingAuth(createStagingAuthApi(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
  ), environment.accounts);
  console.log(`Staging Auth setup complete. Created: ${result.created}; existing owned fixtures: ${result.existing}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error('Staging Auth setup failed. Check configuration, target, fixture ownership, and API access; credential values and emails are not logged.');
    process.exitCode = 1;
  });
}
