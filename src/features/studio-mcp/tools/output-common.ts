import { z } from 'zod';

/** Shared envelope required in both full and text-channel-only MCP results. */
export const commonOutput = {
  rules: z.array(z.string()),
  nextStep: z.string(),
  profileVersion: z.string(),
};
