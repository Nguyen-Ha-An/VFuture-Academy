import 'server-only';

import type { CompletionFacts, CompletionRule } from '@/content-engine';
import { ApiError } from '@/lib/api';

export type QueryResult = { data: unknown; error: unknown | null };

export interface LearnerQuery extends PromiseLike<QueryResult> {
  select(columns: string): this;
  eq(column: string, value: unknown): this;
  gt(column: string, value: unknown): this;
  neq(column: string, value: unknown): this;
  in(column: string, values: unknown[]): this;
  contains(column: string, value: unknown): this;
  or(expression: string): this;
  order(column: string, options?: { ascending?: boolean }): this;
  limit(value: number): this;
  insert(value: unknown): this;
  upsert(value: unknown, options?: unknown): this;
  update(value: unknown): this;
  maybeSingle(): PromiseLike<QueryResult>;
  single(): PromiseLike<QueryResult>;
}

export interface LearnerDatabase {
  from(table: string): LearnerQuery;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<QueryResult>;
}

export type OutlineItem = {
  id: string;
  type: 'lesson' | 'exam' | 'assignment';
  required: boolean;
  title?: unknown;
  estimatedMinutes?: number;
};

export function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const row = recordOf(entry);
    return row ? [row] : [];
  }) : [];
}

export function oneRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return recordOf(value[0]);
  return recordOf(value);
}

export function databaseFailure(error: unknown, message: string): void {
  if (error) throw new ApiError(500, 'LEARNING_DATABASE_ERROR', message);
}

export function branchCanAccess(accessValue: unknown, branchId: string | null): boolean {
  const access = recordOf(accessValue);
  if (access?.scope === 'global') return true;
  return access?.scope === 'branches'
    && branchId !== null
    && Array.isArray(access.branchIds)
    && access.branchIds.includes(branchId);
}

export async function loadBranchId(database: LearnerDatabase, userId: string): Promise<string | null> {
  const { data, error } = await database.from('profiles')
    .select('branch_id')
    .eq('id', userId)
    .maybeSingle();
  databaseFailure(error, 'Learner profile could not be loaded');
  const branchId = recordOf(data)?.branch_id;
  return typeof branchId === 'string' ? branchId : null;
}

export function outlineItems(outlineValue: unknown): OutlineItem[] {
  const modules = recordOf(outlineValue)?.modules;
  if (!Array.isArray(modules)) return [];
  return modules.flatMap((moduleValue) => {
    const items = recordOf(moduleValue)?.items;
    if (!Array.isArray(items)) return [];
    return items.flatMap((itemValue): OutlineItem[] => {
      const item = recordOf(itemValue);
      if (!item || typeof item.id !== 'string' || !['lesson', 'exam', 'assignment'].includes(String(item.type))) return [];
      return [{
        id: item.id,
        type: item.type as OutlineItem['type'],
        required: item.required !== false,
        ...(item.title !== undefined ? { title: item.title } : {}),
        ...(typeof item.estimatedMinutes === 'number' ? { estimatedMinutes: item.estimatedMinutes } : {}),
      }];
    });
  });
}

function finiteNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

export type CompletionRows = {
  lessonProgress: Record<string, 'not_started' | 'in_progress' | 'completed'>;
  facts: CompletionFacts;
};

export async function loadCompletionRows(
  database: LearnerDatabase,
  userId: string,
  versionId: string,
  items: OutlineItem[],
): Promise<CompletionRows> {
  const [lessonResult, examResult, assignmentResult, quizResult] = await Promise.all([
    database.from('lesson_progress')
      .select('item_id,status')
      .eq('user_id', userId)
      .eq('course_version_id', versionId),
    database.from('exam_grades')
      .select('item_id,percent,passed')
      .eq('user_id', userId)
      .eq('course_version_id', versionId),
    database.from('assignment_submissions')
      .select('item_id,block_id,status,submitted_at,grades(decision,released)')
      .eq('user_id', userId)
      .eq('course_version_id', versionId)
      .order('submitted_at', { ascending: false }),
    database.from('quiz_attempts')
      .select('item_id,quiz_id,percent')
      .eq('user_id', userId)
      .eq('course_version_id', versionId),
  ]);
  databaseFailure(lessonResult.error, 'Lesson progress could not be loaded');
  databaseFailure(examResult.error, 'Exam grades could not be loaded');
  databaseFailure(assignmentResult.error, 'Assignment progress could not be loaded');
  databaseFailure(quizResult.error, 'Quiz progress could not be loaded');

  const lessonProgress: CompletionRows['lessonProgress'] = {};
  for (const row of recordsOf(lessonResult.data)) {
    if (typeof row.item_id !== 'string' || !['not_started', 'in_progress', 'completed'].includes(String(row.status))) continue;
    lessonProgress[row.item_id] = row.status as CompletionRows['lessonProgress'][string];
  }

  const examGrades: CompletionFacts['examGrades'] = {};
  for (const row of recordsOf(examResult.data)) {
    if (typeof row.item_id !== 'string' || typeof row.passed !== 'boolean') continue;
    examGrades[row.item_id] = { percent: finiteNumber(row.percent), passed: row.passed };
  }

  const assignmentStatus: CompletionFacts['assignmentStatus'] = {};
  for (const row of recordsOf(assignmentResult.data)) {
    if (typeof row.item_id !== 'string' || !['submitted', 'in_review', 'approved', 'changes_requested'].includes(String(row.status))) continue;
    const key = typeof row.block_id === 'string' ? row.block_id : row.item_id;
    const grade = oneRecord(row.grades);
    if (grade?.released === true && grade.decision === 'approved') {
      assignmentStatus[key] = 'approved';
      continue;
    }
    if (assignmentStatus[key] !== undefined) continue;
    assignmentStatus[key] = grade?.released === true && grade.decision === 'changes_requested'
      ? 'changes_requested'
      : row.status === 'submitted' ? 'submitted' : 'in_review';
  }

  const quizBest: CompletionFacts['quizBest'] = {};
  for (const row of recordsOf(quizResult.data)) {
    if (typeof row.item_id !== 'string' || typeof row.quiz_id !== 'string') continue;
    const key = `${row.item_id}/${row.quiz_id}`;
    quizBest[key] = Math.max(quizBest[key] ?? -1, finiteNumber(row.percent));
  }

  return {
    lessonProgress,
    facts: {
      items: items.map(({ id, type, required }) => ({ id, type, required })),
      lessonsCompleted: Object.entries(lessonProgress).flatMap(([id, status]) => status === 'completed' ? [id] : []),
      examGrades,
      assignmentStatus,
      quizBest,
    },
  };
}

export function completionRules(value: unknown): CompletionRule[] {
  const rules = recordOf(value)?.rules;
  return Array.isArray(rules) ? rules as CompletionRule[] : [];
}

export function itemIsComplete(item: OutlineItem, facts: CompletionFacts): boolean {
  if (item.type === 'lesson') return facts.lessonsCompleted.includes(item.id);
  if (item.type === 'exam') return facts.examGrades[item.id]?.passed === true;
  return facts.assignmentStatus[item.id] === 'approved';
}
