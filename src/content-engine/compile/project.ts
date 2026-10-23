import type { Question } from '../schema/questions';
import type { QuestionSettings } from '../schema/questions/base';
import type { L10nRichContent } from '../schema/types';
import { defaultInteraction } from '../manifest/players';

export const LEARNER_FORBIDDEN_KEYS = ['correctAnswer', 'explanation', 'feedback', 'sampleAnswer', 'sampleSolution', 'sourceRef'] as const;

export interface GradingQuestion {
  id: string; type: Question['type']; points: number; correctAnswer?: unknown; settings: QuestionSettings; interactionType: string;
  selfAssessment: boolean; explanation?: L10nRichContent; optionFeedback?: Record<string, L10nRichContent>;
  skills?: string[];
  matchMode?: 'exact' | 'contains' | 'regex'; tolerance?: number; tolerancePercent?: number; allowManyToOne?: boolean;
  rubricMax?: number; children?: GradingQuestion[]; parentId?: string; sourceRef?: string;
}

/** Learner-safe copy: no keys, explanations, option feedback or samples; ids rewritten to composite ids. */
export function toLearnerQuestion(q: Question, compositeId = q.id): Record<string, unknown> {
  const { correctAnswer: _k, explanation: _e, ...rest } = q as Question & { correctAnswer?: unknown; explanation?: unknown };
  const out: Record<string, unknown> = { ...rest, id: compositeId };
  if ('options' in q) out.options = q.options.map(({ feedback: _f, ...o }) => o);
  if (q.type === 'essay') delete out.sampleAnswer;
  if (q.type === 'code_answer') delete out.sampleSolution;
  if (q.type === 'question_group') out.questions = q.questions.map((c) => toLearnerQuestion(c, `${compositeId}/${c.id}`));
  return out;
}

export function toGradingQuestion(q: Question, compositeId = q.id, parentId?: string, sourceRef?: string): GradingQuestion {
  const rubricMax = 'rubric' in q && q.rubric ? q.rubric.criteria.reduce((s, c) => s + c.maxPoints, 0) : undefined;
  const correctAnswer = (q as { correctAnswer?: unknown }).correctAnswer;
  const g: GradingQuestion = {
    id: compositeId, type: q.type, points: q.points ?? (rubricMax ?? 1), settings: q.settings ?? {}, interactionType: q.display?.interactionType ?? defaultInteraction(q.type), selfAssessment: q.selfAssessment ?? false,
    ...(correctAnswer !== undefined ? { correctAnswer } : {}), ...(q.explanation ? { explanation: q.explanation } : {}), ...(q.skills?.length ? { skills: [...q.skills] } : {}), ...(parentId ? { parentId } : {}), ...(sourceRef ? { sourceRef } : {}), ...(rubricMax !== undefined ? { rubricMax } : {}),
  };
  if ('options' in q) { const fb = Object.fromEntries(q.options.filter((o) => o.feedback).map((o) => [o.id, o.feedback!])); if (Object.keys(fb).length) g.optionFeedback = fb; }
  if (q.type === 'short_answer') g.matchMode = q.matchMode ?? 'exact';
  if (q.type === 'numeric') { if (q.tolerance !== undefined) g.tolerance = q.tolerance; if (q.tolerancePercent !== undefined) g.tolerancePercent = q.tolerancePercent; }
  if (q.type === 'matching') g.allowManyToOne = q.allowManyToOne ?? false;
  if (q.type === 'question_group') { g.children = q.questions.map((c) => toGradingQuestion(c, `${compositeId}/${c.id}`, compositeId)); g.points = g.children.reduce((s, c) => s + c.points, 0); }
  return g;
}

/** Subtrees that never carry answer material: quiz `settings.feedback` and `display` are presentation, not answers. */
export const LEARNER_SKIPPED_SUBTREES = ['settings', 'display'] as const;

/** Throws if a learner payload still carries any privileged key. */
export function assertNoAnswerKeys(payload: unknown, path = ''): void {
  if (Array.isArray(payload)) { payload.forEach((v, i) => assertNoAnswerKeys(v, `${path}/${i}`)); return; }
  if (typeof payload !== 'object' || payload === null) return;
  for (const [k, v] of Object.entries(payload)) {
    if ((LEARNER_SKIPPED_SUBTREES as readonly string[]).includes(k)) continue;
    if ((LEARNER_FORBIDDEN_KEYS as readonly string[]).includes(k)) throw new Error(`learner payload leaks "${k}" at ${path}/${k}`);
    assertNoAnswerKeys(v, `${path}/${k}`);
  }
}
