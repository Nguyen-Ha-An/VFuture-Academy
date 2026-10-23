import type { BenchSurface } from '../../../src/features/workspace/presentation';

/**
 * Catmin staff is always on (the learner Bench has no flag at all). For auth, use an explicit E2E
 * override when testing a remote server; a local test run inherits its UI_V2_SURFACES setting.
 */
export function benchSurfaceEnabled(surface: BenchSurface): boolean {
  if (surface === 'studio' || surface === 'grading' || surface === 'admin') return true;
  return (process.env.E2E_UI_V2_SURFACES ?? process.env.UI_V2_SURFACES ?? '').split(',').map(value => value.trim()).includes(surface);
}
