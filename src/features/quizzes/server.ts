import 'server-only';

import type { Locale } from '@/content-engine';
import { ApiError } from '@/lib/api';
import type { QuizActor, QuizDatabase } from './service';

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function localeOf(value: unknown): Locale {
  return value === 'en' ? 'en' : 'vi';
}

export async function learnerQuizActor(database: QuizDatabase, userId: string): Promise<QuizActor> {
  const result = await database.from('profiles')
    .select('locale')
    .eq('id', userId)
    .maybeSingle();
  if (result.error) throw new ApiError(500, 'DATABASE_ERROR', 'Unable to load learner profile');
  return { id: userId, locale: localeOf(recordOf(result.data)?.locale) };
}
