import { createClient } from "@supabase/supabase-js";

import type { SeededRole } from "./auth";

export const E2E_LEARNER_STATE_TABLES = [
  "grades",
  "assignment_submissions",
  "exam_attempts",
  "exam_grades",
  "quiz_attempts",
  "activity_state",
  "lesson_progress",
  "certificates",
  "skill_evidence",
  "xp_events",
  "streaks",
  "course_completions",
  "learner_upload_rate_limits",
  "assignment_submission_rate_limits",
  "enrollments",
];

export type LearnerStateResetter = {
  findUserId(email: string): Promise<string | null>;
  deleteForUser(table: string, userId: string): Promise<void>;
};

export function assertE2EResetTarget(
  supabaseUrl: string,
  source: Record<string, string | undefined>,
): void {
  const hostname = new URL(supabaseUrl).hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") return;
  const projectRef = source.SEED_DEV_PROJECT_REF?.trim().toLowerCase();
  if (projectRef && /^[a-z0-9-]+$/.test(projectRef) && hostname === `${projectRef}.supabase.co`) return;
  throw new Error("Refusing to reset E2E learner state outside the explicit development project.");
}

export async function resetSeededLearners(
  fixtures: Array<{ role: SeededRole; email: string }>,
  resetter: LearnerStateResetter,
): Promise<void> {
  const resolved = await Promise.all(fixtures.map(async (fixture) => {
    const userId = await resetter.findUserId(fixture.email);
    if (!userId) throw new Error(`The ${fixture.role} reset account does not exist.`);
    return { ...fixture, userId };
  }));
  if (new Set(resolved.map(({ userId }) => userId)).size !== resolved.length) {
    throw new Error("Mutable E2E learner fixtures must use distinct auth accounts.");
  }
  for (const { userId } of resolved) {
    for (const table of E2E_LEARNER_STATE_TABLES) {
      await resetter.deleteForUser(table, userId);
    }
  }
}

function productionResetter(supabaseUrl: string, serviceRoleKey: string): LearnerStateResetter {
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async findUserId(email) {
      const perPage = 1_000;
      for (let page = 1; ; page += 1) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage });
        if (error) throw new Error("Unable to locate a seeded learner for E2E reset.");
        const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase());
        if (user) {
          if (user.app_metadata?.recovery_fixture !== true) {
            throw new Error("Refusing to reset a learner without the server-owned recovery fixture marker.");
          }
          return user.id;
        }
        if (data.users.length < perPage) return null;
      }
    },
    async deleteForUser(table, userId) {
      const { error } = await client.from(table).delete().eq("user_id", userId);
      if (error) throw new Error(`Unable to reset seeded learner table ${table}.`);
    },
  };
}

const mutableLearnerEmails: Array<{ role: SeededRole; environment: string }> = [
  { role: "learner", environment: "SEED_E2E_LEARNER_EMAIL" },
  { role: "keyboardLearner", environment: "SEED_E2E_KEYBOARD_LEARNER_EMAIL" },
  { role: "a11yLearner", environment: "SEED_E2E_A11Y_LEARNER_EMAIL" },
];

export async function resetConfiguredLearnerStates(
  source: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (source.E2E_RESET_SEEDED_LEARNERS !== "1") return;
  const supabaseUrl = source.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = source.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("E2E learner reset requires the Supabase URL and service-role key.");
  }
  assertE2EResetTarget(supabaseUrl, source);
  const fixtures = mutableLearnerEmails.flatMap(({ role, environment }) => {
    const email = source[environment]?.trim();
    return email ? [{ role, email }] : [];
  });
  if (fixtures.length === 0) throw new Error("E2E learner reset requires at least one mutable learner email.");
  await resetSeededLearners(fixtures, productionResetter(supabaseUrl, serviceRoleKey));
}
