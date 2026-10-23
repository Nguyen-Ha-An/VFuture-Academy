import type { CompletionRule } from '../schema/course';
import type { GradingItem } from '../compile';

export type AssignmentStatus = 'submitted' | 'in_review' | 'approved' | 'changes_requested';
export interface CompletionFacts {
  items: { id: string; type: 'lesson' | 'exam' | 'assignment'; required: boolean }[];
  lessonsCompleted: string[];
  examGrades: Record<string, { percent: number; passed: boolean }>;
  assignmentStatus: Record<string, AssignmentStatus>;
  quizBest: Record<string, number>; // `${lessonId}/${quizId}` → best percent
}
export interface Requirement { rule: CompletionRule; satisfied: boolean; progress?: { done: number; total: number } }

function itemDone(item: CompletionFacts['items'][number], f: CompletionFacts): boolean {
  if (item.type === 'lesson') return f.lessonsCompleted.includes(item.id);
  if (item.type === 'exam') return f.examGrades[item.id]?.passed === true;
  return f.assignmentStatus[item.id] === 'approved';
}

export function evaluateCompletion(rules: CompletionRule[], f: CompletionFacts): { complete: boolean; requirements: Requirement[] } {
  const requirements: Requirement[] = rules.map((rule) => {
    switch (rule.type) {
      case 'all_items': { const req = f.items.filter((i) => i.required); const done = req.filter((i) => itemDone(i, f)).length; return { rule, satisfied: done === req.length, progress: { done, total: req.length } }; }
      case 'lessons_completed': { const ids = rule.lessonIds === 'all' ? f.items.filter((i) => i.type === 'lesson').map((i) => i.id) : rule.lessonIds; const done = ids.filter((id) => f.lessonsCompleted.includes(id)).length; return { rule, satisfied: done === ids.length, progress: { done, total: ids.length } }; }
      case 'exam_passed': return { rule, satisfied: f.examGrades[rule.examId]?.passed === true };
      case 'assignment_approved': return { rule, satisfied: f.assignmentStatus[rule.assignmentId] === 'approved' };
      case 'quiz_min_score': return { rule, satisfied: (f.quizBest[`${rule.lessonId}/${rule.quizId}`] ?? -1) >= rule.percent };
    }
  });
  return { complete: requirements.every((r) => r.satisfied), requirements };
}

export interface LessonFacts { viewed: boolean; completedActivities: string[]; quizBest: Record<string, number> }
export function evaluateLessonCompletion(grading: GradingItem, f: LessonFacts): { complete: boolean; pending: string[] } {
  if ((grading.lessonCompletionMode ?? 'view') === 'view') return { complete: f.viewed, pending: f.viewed ? [] : ['view'] };
  const pending: string[] = [];
  for (const a of grading.activities) {
    if (!a.required) continue;
    if (!f.completedActivities.includes(a.id)) { pending.push(a.id); continue; }
    if (a.type === 'quiz') { const pass = grading.quizzes[a.id]?.passPercent; if (pass !== undefined && (f.quizBest[a.id] ?? -1) < pass) pending.push(a.id); }
  }
  return { complete: pending.length === 0, pending };
}
