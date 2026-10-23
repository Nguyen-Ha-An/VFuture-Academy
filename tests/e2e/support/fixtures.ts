import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  openRoleContext,
  unavailableRoleStorageStateMessage,
  type SeededRole,
} from "./auth";

type RoleFixtures = {
  role: SeededRole;
  roleContext: BrowserContext;
  rolePage: Page;
};

export const test = base.extend<RoleFixtures>({
  role: ["learner", { option: true }],
  roleContext: async ({ browser, role, baseURL }, provide, testInfo) => {
    const unavailable = unavailableRoleStorageStateMessage([role]);
    if (unavailable) {
      // In required CI, unavailableRoleStorageStateMessage throws instead of allowing a silent role skip.
      testInfo.skip(true, unavailable);
      return;
    }
    const context = await openRoleContext(browser, role, baseURL ?? "http://127.0.0.1:3000");
    try {
      await provide(context);
    } finally {
      await context.close();
    }
  },
  rolePage: async ({ roleContext }, provide) => {
    const page = await roleContext.newPage();
    await provide(page);
  },
});

export { expect };
