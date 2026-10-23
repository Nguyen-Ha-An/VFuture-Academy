import type { StaffWorkspace } from '@/lib/workspaces';

type Env = Record<string, string | undefined>;
const processEnv = (): Env => typeof process === 'undefined' ? {} : process.env;

function listed(setting: string | undefined, value: string): boolean {
  return (setting ?? '').split(',').map(entry => entry.trim()).includes(value);
}

/**
 * Historical legacy staff flag parser, retained for source cleanup compatibility.
 * It no longer selects the rendered staff shell.
 */
export function staffPresentationEnabled(workspace: StaffWorkspace, setting: string | undefined): boolean {
  return listed(setting, workspace);
}

export type BenchSurface = 'auth' | StaffWorkspace;

/**
 * Only auth remains opt-in (`UI_V2_SURFACES` lists `auth`). Staff pages were converted
 * in place, so they always report enabled regardless of the setting. The learner Bench
 * is unconditional (the legacy learner UI is deleted) and has no flag here; listing
 * `learner` in `UI_V2_SURFACES` does nothing. Rollback uses a previous deployment
 * revision rather than this setting.
 */
export function uiV2Enabled(surface: BenchSurface, env: Env = processEnv()): boolean {
  if (surface === 'studio' || surface === 'grading' || surface === 'admin') return true;
  return listed(env.UI_V2_SURFACES, surface);
}

/**
 * Staff pages and shell now render Catmin together. The legacy branches remain
 * temporarily for source-level cleanup, but no environment setting selects them.
 */
export type StaffShellVariant = 'catmin' | 'redesigned' | 'classic';

export function staffShellVariant(_workspace: StaffWorkspace, _env: Env = processEnv()): StaffShellVariant {
  return 'catmin';
}
