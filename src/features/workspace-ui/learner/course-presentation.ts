import type { CompletionRule } from '@/content-engine/schema/course';

type OutlineItem = { id: string; type: unknown; title: string };
export type RequirementTarget = { id: string; title: string | null; itemId?: string };

/** Labels only: the caller retains the original rule, satisfied flag and progress. */
export function requirementTargets(rule: CompletionRule, items: readonly OutlineItem[]): RequirementTarget[] {
  const target = (id: string, type: string, linkable = true): RequirementTarget => {
    const matches = items.filter(item => item.id === id);
    const item = matches.length === 1 && matches[0].type === type ? matches[0] : undefined;
    const title = item?.title.trim() || null;
    return { id, title, ...(title && linkable ? { itemId: id } : {}) };
  };
  switch (rule.type) {
    case 'exam_passed': return [target(rule.examId, 'exam')];
    case 'assignment_approved': return [target(rule.assignmentId, 'assignment')];
    case 'lessons_completed': return rule.lessonIds === 'all' ? [] : rule.lessonIds.map(id => target(id, 'lesson'));
    case 'quiz_min_score':
      // The rule identifies the lesson, but the outline does not contain quiz titles.
      // Do not infer an embedded title or create a link to an unobserved block.
      return [target(rule.lessonId, 'lesson', false), { id: rule.quizId, title: null }];
    case 'all_items': return [];
  }
}

/** The published schema supplies positive whole minutes; do not invent missing durations. */
export function courseDuration(minutes: number): { hours: number; minutes: number } | null {
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return null;
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
