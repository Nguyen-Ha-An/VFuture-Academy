import { loadEnvConfig } from '@next/env';

/** Load Next-compatible local environment files before running a Node script. */
export function loadEnvironment(cwd = process.cwd()) {
  return loadEnvConfig(cwd);
}
