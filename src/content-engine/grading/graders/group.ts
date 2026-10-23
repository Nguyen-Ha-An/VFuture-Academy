import type { GradingQuestion } from '../../compile/project';
import type { QuestionResult } from '../types';
import { round2 } from '../types';

export function gradeGroup(gq: GradingQuestion, answer: unknown, gradeChild: (c: GradingQuestion, a: unknown) => QuestionResult): QuestionResult {
  const given = (answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {}) as Record<string, unknown>;
  const children = (gq.children ?? []).map((c) => gradeChild(c, given[c.id] ?? given[c.id.slice(gq.id.length + 1)]));
  const points = round2(children.reduce((s, c) => s + c.points, 0));
  const maxPoints = children.reduce((s, c) => s + c.maxPoints, 0);
  const statuses = new Set(children.map((c) => c.status));
  const status = statuses.has('pending_manual') ? 'pending_manual' : children.every((c) => c.status === 'incomplete') ? 'incomplete' : children.every((c) => c.status === 'correct' || c.status === 'self_assessed') ? 'correct' : points > 0 ? 'partial' : 'incorrect';
  return { questionId: gq.id, status, points, maxPoints, children };
}
