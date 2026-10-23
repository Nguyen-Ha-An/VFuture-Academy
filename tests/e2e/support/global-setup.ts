import type { FullConfig } from "@playwright/test";

import { prepareConfiguredRoleStates, prepareRemoteAccessState } from "./auth";
import { resetConfiguredLearnerStates } from "./reset";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const configuredBaseURL = config.projects[0]?.use.baseURL;
  const baseURL = typeof configuredBaseURL === "string"
    ? configuredBaseURL
    : process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
  await prepareRemoteAccessState(baseURL);
  await resetConfiguredLearnerStates();
  await prepareConfiguredRoleStates(baseURL);
}
