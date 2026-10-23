import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { bootstrapVercelProtection } from "../../../scripts/lib/vercel-protection";

export const REMOTE_ACCESS_STATE_PATH = "playwright/.auth/remote-access.json";

export const SEEDED_ROLES = [
  "admin",
  "learner",
  "completedLearner",
  "precompletionLearner",
  "keyboardLearner",
  "a11yLearner",
  "instructor",
  "branchLead",
] as const;
export type SeededRole = (typeof SEEDED_ROLES)[number];

const stateEnvironment: Record<SeededRole, string> = {
  admin: "PLAYWRIGHT_ADMIN_STORAGE_STATE",
  learner: "PLAYWRIGHT_LEARNER_STORAGE_STATE",
  completedLearner: "PLAYWRIGHT_COMPLETED_LEARNER_STORAGE_STATE",
  precompletionLearner: "PLAYWRIGHT_PRECOMPLETION_LEARNER_STORAGE_STATE",
  keyboardLearner: "PLAYWRIGHT_KEYBOARD_LEARNER_STORAGE_STATE",
  a11yLearner: "PLAYWRIGHT_A11Y_LEARNER_STORAGE_STATE",
  instructor: "PLAYWRIGHT_INSTRUCTOR_STORAGE_STATE",
  branchLead: "PLAYWRIGHT_BRANCH_LEAD_STORAGE_STATE",
};

const defaultStateNames: Record<SeededRole, string> = {
  admin: "admin.json",
  learner: "learner.json",
  completedLearner: "completed-learner.json",
  precompletionLearner: "precompletion-learner.json",
  keyboardLearner: "keyboard-learner.json",
  a11yLearner: "a11y-learner.json",
  instructor: "instructor.json",
  branchLead: "branch-lead.json",
};

const credentialEnvironment: Record<SeededRole, { email: string; password: string }> = {
  admin: { email: "SEED_ADMIN_EMAIL", password: "SEED_ADMIN_PASSWORD" },
  learner: { email: "SEED_E2E_LEARNER_EMAIL", password: "SEED_LEARNER_PASSWORD" },
  completedLearner: { email: "SEED_E2E_COMPLETED_LEARNER_EMAIL", password: "SEED_COMPLETED_LEARNER_PASSWORD" },
  precompletionLearner: { email: "SEED_E2E_PRECOMPLETION_LEARNER_EMAIL", password: "SEED_PRECOMPLETION_LEARNER_PASSWORD" },
  keyboardLearner: { email: "SEED_E2E_KEYBOARD_LEARNER_EMAIL", password: "SEED_KEYBOARD_LEARNER_PASSWORD" },
  a11yLearner: { email: "SEED_E2E_A11Y_LEARNER_EMAIL", password: "SEED_A11Y_LEARNER_PASSWORD" },
  instructor: { email: "SEED_E2E_INSTRUCTOR_EMAIL", password: "SEED_INSTRUCTOR_PASSWORD" },
  branchLead: { email: "SEED_E2E_BRANCH_LEAD_EMAIL", password: "SEED_BRANCH_LEAD_PASSWORD" },
};

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function roleStorageStatePath(role: SeededRole): string {
  const configured = process.env[stateEnvironment[role]]?.trim();
  const repository = resolve(process.cwd());
  const statePath = resolve(repository, configured || `playwright/.auth/${defaultStateNames[role]}`);
  const authDirectory = resolve(repository, "playwright/.auth");
  if (configured && isWithin(repository, statePath) && !isWithin(authDirectory, statePath)) {
    throw new Error("Playwright storage state inside the repository must be under playwright/.auth.");
  }
  return statePath;
}

export function hasRoleStorageState(role: SeededRole): boolean {
  return existsSync(roleStorageStatePath(role));
}

export function unavailableRoleStorageStateMessage(roles: readonly SeededRole[]): string | null {
  const missing = roles.filter((role) => !hasRoleStorageState(role));
  if (missing.length === 0) return null;
  const message = `Missing Playwright storage state for: ${missing.join(", ")}. Run the seed and provide role credentials or approved storage-state paths.`;
  if (process.env.CI || process.env.E2E_REQUIRE_ROLE_STATES === '1') throw new Error(message);
  return message;
}

function roleCredentials(role: SeededRole): { email: string; password: string } | null {
  const names = credentialEnvironment[role];
  const email = process.env[names.email]?.trim();
  const password = process.env[names.password];
  return email && password ? { email, password } : null;
}

export async function setLocale(
  context: BrowserContext,
  baseURL: string,
  locale: "vi" | "en",
): Promise<void> {
  await bootstrapVercelProtection(context.request, baseURL, process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  await context.addCookies([{ name: "locale", value: locale, url: baseURL }]);
}

export async function setEnglishLocale(context: BrowserContext, baseURL: string): Promise<void> {
  await setLocale(context, baseURL, "en");
}

async function signInAndSaveState(
  browser: Browser,
  baseURL: string,
  role: SeededRole,
  credentials: { email: string; password: string },
): Promise<void> {
  const statePath = roleStorageStatePath(role);
  await mkdir(dirname(statePath), { recursive: true });
  const context = await browser.newContext({ baseURL });
  try {
    await setEnglishLocale(context, baseURL);
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(credentials.email);
    await page.getByLabel("Password").fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/(app|home|welcome|studio)(?:\/|$)/, { timeout: 20_000 });
    await context.storageState({ path: statePath });
  } catch (error) {
    throw new Error(`Unable to create the ${role} Playwright storage state.`, { cause: error });
  } finally {
    await context.close();
  }
}

export async function prepareRemoteAccessState(baseURL: string): Promise<void> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return;
  const statePath = resolve(process.cwd(), REMOTE_ACCESS_STATE_PATH);
  await mkdir(dirname(statePath), { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL });
    try {
      await bootstrapVercelProtection(context.request, baseURL, secret);
      await context.storageState({ path: statePath });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

export async function prepareConfiguredRoleStates(baseURL: string): Promise<void> {
  const roles = SEEDED_ROLES.flatMap((role) => {
    if (hasRoleStorageState(role)) return [];
    const credentials = roleCredentials(role);
    return credentials ? [{ role, credentials }] : [];
  });
  if (roles.length === 0) return;

  const browser = await chromium.launch();
  try {
    for (const { role, credentials } of roles) {
      await signInAndSaveState(browser, baseURL, role, credentials);
    }
  } finally {
    await browser.close();
  }
}

export async function openRoleContext(
  browser: Browser,
  role: SeededRole,
  baseURL: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL, storageState: roleStorageStatePath(role) });
  await setEnglishLocale(context, baseURL);
  return context;
}

export async function openRolePage(
  browser: Browser,
  role: SeededRole,
  baseURL: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await openRoleContext(browser, role, baseURL);
  return { context, page: await context.newPage() };
}
