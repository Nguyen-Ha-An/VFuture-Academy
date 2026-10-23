import type { ReactNode } from 'react';
import { uiV2Enabled } from '@/features/workspace/presentation';

/** Whether the auth family renders the Calibration Bench shell (`UI_V2_SURFACES` lists `auth`). */
export function authBenchEnabled(): boolean {
  return uiV2Enabled('auth');
}

/**
 * The page's single `<main>`. Legacy output is unchanged; in bench mode it sits inside the
 * shell's form panel, so it drops the full-height centring that the panel already provides.
 */
export function AuthMain({ bench, children }: { bench: boolean; children: ReactNode }) {
  if (bench) return <main className="vf-auth-main">{children}</main>;
  return <main className="flex min-h-screen items-center px-4 py-8">{children}</main>;
}
