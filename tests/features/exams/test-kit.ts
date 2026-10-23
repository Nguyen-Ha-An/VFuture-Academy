import {
  compileBankQuestion,
  compileCourse,
  type CompiledItem,
} from '@/content-engine/compile';
import { FIXTURES, fixtureResolver } from '@/content-engine/fixtures';
import type { Locale } from '@/content-engine/schema/common';
import type {
  BankListQuery,
  BankSource,
  Clock,
  ExamActor,
  ExamItemContext,
} from '@/features/exams/types';

const locales: Locale[] = ['vi', 'en'];

export const learner: ExamActor = { id: 'learner-1', locale: 'en' };
export const otherLearner: ExamActor = { id: 'learner-2', locale: 'en' };
export const instructor: ExamActor = {
  id: 'instructor-1',
  locale: 'en',
  permissions: ['exam.release', 'submission.grade'],
};

export class MutableClock implements Clock {
  constructor(private current: Date) {}

  now() {
    return new Date(this.current);
  }

  set(value: string | Date) {
    this.current = new Date(value);
  }
}

export const bankSource: BankSource = {
  async listPublished(query: BankListQuery) {
    const ids = 'from' in query
      ? query.from.map((ref) => ref.replace(/^bank:/, ''))
      : await fixtureResolver.bankCandidates(query.filter);
    const entries = await Promise.all(ids.map(async (id) => {
      const snapshot = await fixtureResolver.bankQuestion(id);
      if (!snapshot) return null;
      const compiled = await compileBankQuestion(snapshot.question as never, locales, 'vi');
      return { id, versionId: snapshot.versionId, grading: compiled.grading, renders: compiled.renders };
    }));
    return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  },
};

export async function compileExamFixtures() {
  const [ai, all] = await Promise.all([
    compileCourse(FIXTURES['ai-foundations'], fixtureResolver, { publish: true }),
    compileCourse(FIXTURES['all-question-types'], fixtureResolver, { publish: true }),
  ]);
  if (!ai.ok || !ai.compiled || !all.ok || !all.compiled) {
    throw new Error(`fixture compilation failed: ${JSON.stringify([...ai.diagnostics, ...all.diagnostics])}`);
  }
  return {
    ai: ai.compiled.items['exam-m1'],
    all: all.compiled.items['exam-all'],
  };
}

export function itemContext(item: CompiledItem): ExamItemContext {
  return {
    courseVersionId: `version-${item.id}`,
    item,
    enrolled: true,
    defaultLocale: item.renders.en ? 'en' : 'vi',
    branchId: null,
  };
}

export function withExamSettings(
  item: CompiledItem,
  patch: Partial<NonNullable<CompiledItem['grading']['exam']>>,
): CompiledItem {
  const copy = structuredClone(item);
  copy.grading.exam = { ...copy.grading.exam!, ...patch };
  return copy;
}
