import 'server-only';

import { supabaseService } from '@/lib/supabase/server';

/** Server operations are independent of optional browser measurement consent. */
export const ANALYTICS_EVENT_NAMES = [
  'course.enrolled',
  'lesson.completed',
  'quiz.submitted',
  'exam.started',
  'exam.submitted',
  'assignment.submitted',
  'assignment.graded',
  'course.completed',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

type AnalyticsValue = string | number | boolean | null;
export type ServerAnalyticsProps = Record<string, AnalyticsValue> & { userId?: string | null };

const ANALYTICS_EVENT_NAME_SET = new Set<string>(ANALYTICS_EVENT_NAMES);
const MAX_ANALYTICS_PROPS_BYTES = 4 * 1024;
const ANALYTICS_TIMEOUT_MS = 1_500;

export function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === 'string' && ANALYTICS_EVENT_NAME_SET.has(value);
}

function serializedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Best-effort server event recording. Analytics failures never fail the caller's operation. */
export async function track(name: AnalyticsEventName, props: ServerAnalyticsProps = {}): Promise<void> {
  if (!isAnalyticsEventName(name)) return;
  try {
    const { userId = null, ...eventProps } = props;
    if (serializedBytes(eventProps) > MAX_ANALYTICS_PROPS_BYTES) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ANALYTICS_TIMEOUT_MS);
      });
      await Promise.race([Promise.resolve(supabaseService().from('analytics_events').insert({
        user_id: userId,
        name,
        props: eventProps,
      })).then(() => undefined), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    // Operational analytics must never block the learner or Studio transaction.
  }
}
