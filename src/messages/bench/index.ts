import auth from './auth.json';
import learner from './learner.json';
import profile from './profile.json';
import shared from './shared.json';
import staff from './staff.json';

type Locale = 'vi' | 'en';

/**
 * Calibration Bench strings live in per-area files (shared/auth/learner/profile/staff), merged under
 * the `bench` namespace so each surface owns its catalog without editing the main locale file.
 */
export function benchMessages(locale: Locale) {
  return { shared: shared[locale], auth: auth[locale], learner: learner[locale], profile: profile[locale], staff: staff[locale] };
}

export function withBenchMessages<T extends Record<string, unknown>>(messages: T, locale: Locale): T & { bench: ReturnType<typeof benchMessages> } {
  return { ...messages, bench: benchMessages(locale) };
}
