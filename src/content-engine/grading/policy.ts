import { round2 } from './types';
export type ScoringPolicy = 'best' | 'latest' | 'first' | 'average';
export function applyScoringPolicy(policy: ScoringPolicy, percents: number[]): number {
  if (!percents.length) return 0;
  switch (policy) {
    case 'best': return Math.max(...percents);
    case 'latest': return percents[percents.length - 1];
    case 'first': return percents[0];
    case 'average': return round2(percents.reduce((s, p) => s + p, 0) / percents.length);
  }
}
