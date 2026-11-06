import type { ReactNode } from 'react';

export function authBenchEnabled(): boolean { return false; }
export function AuthMain({ children }: { bench: boolean; children: ReactNode }) {
  return <main>{children}</main>;
}
