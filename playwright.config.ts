import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { playwrightTarget } from "./scripts/lib/playwright-target";

loadEnvConfig(process.cwd());

const target = playwrightTarget(process.env);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/support/global-setup.ts",
  use: {
    baseURL: target.baseURL,
    ...(target.storageState ? { storageState: target.storageState } : {}),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  ...(target.webServer ? { webServer: target.webServer } : {}),
});
