import { describe, expect, it } from "vitest";

import {
  E2E_LEARNER_STATE_TABLES,
  assertE2EResetTarget,
  resetSeededLearners,
  type LearnerStateResetter,
} from "../e2e/support/reset";

function resetter(users: Record<string, string>): LearnerStateResetter & {
  deletes: Array<{ table: string; userId: string }>;
} {
  const deletes: Array<{ table: string; userId: string }> = [];
  return {
    deletes,
    async findUserId(email) {
      return users[email] ?? null;
    },
    async deleteForUser(table, userId) {
      deletes.push({ table, userId });
    },
  };
}

describe("Playwright seeded learner reset", () => {
  it("clears every mutable learning table for each distinct fixture", async () => {
    const service = resetter({
      "journey@example.test": "user-journey",
      "keyboard@example.test": "user-keyboard",
      "a11y@example.test": "user-a11y",
    });

    await resetSeededLearners([
      { role: "learner", email: "journey@example.test" },
      { role: "keyboardLearner", email: "keyboard@example.test" },
      { role: "a11yLearner", email: "a11y@example.test" },
    ], service);

    expect(service.deletes).toHaveLength(E2E_LEARNER_STATE_TABLES.length * 3);
    expect(service.deletes.filter(({ userId }) => userId === "user-keyboard").map(({ table }) => table))
      .toEqual(E2E_LEARNER_STATE_TABLES);
  });

  it("refuses aliases before deleting any state", async () => {
    const service = resetter({
      "journey@example.test": "shared-user",
      "keyboard@example.test": "shared-user",
    });

    await expect(resetSeededLearners([
      { role: "learner", email: "journey@example.test" },
      { role: "keyboardLearner", email: "keyboard@example.test" },
    ], service)).rejects.toThrow("distinct auth accounts");
    expect(service.deletes).toEqual([]);
  });

  it("allows only loopback or the explicit development project ref", () => {
    expect(() => assertE2EResetTarget("http://127.0.0.1:54321", {})).not.toThrow();
    expect(() => assertE2EResetTarget("https://dev-ref.supabase.co", {
      SEED_DEV_PROJECT_REF: "dev-ref",
    })).not.toThrow();
    expect(() => assertE2EResetTarget("https://production-ref.supabase.co", {
      SEED_DEV_PROJECT_REF: "different-ref",
    })).toThrow("Refusing to reset E2E learner state");
  });
});
