import 'server-only';

import { randomUUID } from 'node:crypto';

import type { CompiledCourse, Locale, L10nString } from '@/content-engine';
import { ApiError } from '@/lib/api';
import { routes } from '@/lib/routes';
import { supabaseService } from '@/lib/supabase/server';

export const SKILL_LEVELS = ['exposed', 'applied', 'demonstrated'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const SKILL_EVIDENCE_TYPES = [
  'course_completion',
  'exam_passed',
  'assignment_approved',
  'project_contribution',
  'mentor_review',
  'competition_result',
] as const;
export type SkillEvidenceType = (typeof SKILL_EVIDENCE_TYPES)[number];

export const SKILL_CATEGORIES = [
  'ai',
  'technology',
  'research',
  'entrepreneurship',
  'fintech',
  'core-skills',
  'other',
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

type QueryResult = { data: unknown; error: unknown | null };

export interface SkillsQuery extends PromiseLike<QueryResult> {
  select(columns: string): SkillsQuery;
  upsert(value: unknown, options?: unknown): SkillsQuery;
  eq(column: string, value: unknown): SkillsQuery;
  in(column: string, values: unknown[]): SkillsQuery;
  order(column: string, options?: unknown): SkillsQuery;
  limit(value: number): SkillsQuery;
  single(): Promise<QueryResult>;
  maybeSingle(): Promise<QueryResult>;
}

export interface SkillsDatabase {
  from(table: string): SkillsQuery;
}

export type SkillsDependencies = {
  client?: SkillsDatabase;
};

export type SkillDeclaration = {
  id: string;
  name: L10nString;
};

export type CompletionEvidenceSource = {
  user_id: string;
  course_id: string;
  course_version_id: string;
  completed_at: string;
};

export type ExamEvidenceSource = {
  id: string;
  userId: string;
  gradingSnapshot: {
    questions: Record<string, { skills?: readonly string[] }>;
  };
};

export type AssignmentEvidenceSource = {
  userId: string;
  submissionId: string;
  skills: readonly string[];
};

export type PassportEvidence = {
  id: string;
  level: SkillLevel;
  evidenceType: SkillEvidenceType;
  refType: string;
  refId: string;
  createdAt: string;
  href: string | null;
};

export type PassportSkill = {
  id: string;
  name: L10nString;
  category: SkillCategory;
  level: SkillLevel;
  evidence: PassportEvidence[];
};

function database(deps?: SkillsDependencies): SkillsDatabase {
  return deps?.client ?? (supabaseService() as unknown as SkillsDatabase);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((entry) => {
    const row = record(entry);
    return row ? [row] : [];
  }) : [];
}

function databaseFailure(message: string): never {
  throw new ApiError(500, 'SKILLS_DATABASE_ERROR', message);
}

function skillName(value: unknown): L10nString | null {
  if (typeof value === 'string' && value.length > 0) return value;
  const map = record(value);
  if (!map) return null;
  const localized = Object.fromEntries((['vi', 'en'] as Locale[]).flatMap((locale) => (
    typeof map[locale] === 'string' && map[locale].length > 0 ? [[locale, map[locale]]] : []
  )));
  return Object.keys(localized).length ? localized as L10nString : null;
}

function declarationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => {
    const declaration = record(entry);
    return typeof declaration?.id === 'string' ? [declaration.id] : [];
  }))];
}

export function categoryForPathway(pathway: string): SkillCategory {
  switch (pathway) {
    case 'ai-emerging-technology': return 'ai';
    case 'research-innovation': return 'research';
    case 'entrepreneurship-product': return 'entrepreneurship';
    case 'fintech-economics': return 'fintech';
    case 'core-future-skills': return 'core-skills';
    default: return 'other';
  }
}

/** Includes every grading reference so later evidence inserts always have a skill parent row. */
export function declarationsFromCompiledCourse(
  course: Pick<CompiledCourse, 'skills' | 'items'>,
): SkillDeclaration[] {
  const declarations = new Map(course.skills.map((skill) => [skill.id, skill]));
  const includeReference = (skillId: string) => {
    if (!declarations.has(skillId)) declarations.set(skillId, { id: skillId, name: skillId });
  };

  for (const item of Object.values(course.items)) {
    for (const question of Object.values(item.grading.questions)) {
      for (const skillId of question.skills ?? []) includeReference(skillId);
    }
    for (const assignment of Object.values(item.grading.assignments ?? {})) {
      for (const skillId of assignment.skills ?? []) includeReference(skillId);
    }
  }

  return [...declarations.values()];
}

/** Synchronizes declarations from a validated course manifest before publication. */
export async function upsertFromManifest(
  declarations: readonly SkillDeclaration[],
  category: SkillCategory,
  deps?: SkillsDependencies,
): Promise<void> {
  if (!declarations.length) return;
  const result = await database(deps).from('skills').upsert(
    declarations.map(({ id, name }) => ({
      id,
      name,
      category,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (result.error) databaseFailure('Unable to synchronize course skills');
}

async function recordEvidenceIndependently(
  userId: string,
  skillId: string,
  level: SkillLevel,
  evidenceType: SkillEvidenceType,
  refType: string,
  refId: string,
  deps?: SkillsDependencies,
): Promise<void> {
  try {
    await recordEvidence(userId, skillId, level, evidenceType, refType, refId, deps);
  } catch (error) {
    const correlationId = randomUUID();
    console.error(`[skill-evidence:${correlationId}] Unable to record evidence`, {
      skillId,
      evidenceType,
      refType,
      refId,
      error,
    });
  }
}

/** Inserts one evidence receipt; repeated delivery is absorbed by the unique constraint. */
export async function recordEvidence(
  userId: string,
  skillId: string,
  level: SkillLevel,
  evidenceType: SkillEvidenceType,
  refType: string,
  refId: string,
  deps?: SkillsDependencies,
): Promise<void> {
  const result = await database(deps).from('skill_evidence').upsert({
    user_id: userId,
    skill_id: skillId,
    level,
    evidence_type: evidenceType,
    ref_type: refType,
    ref_id: refId,
    updated_at: new Date().toISOString(),
  }, {
    onConflict: 'user_id,skill_id,evidence_type,ref_id',
    ignoreDuplicates: true,
  });
  if (result.error) databaseFailure('Unable to record skill evidence');
}

export async function onCourseCompleted(
  completion: CompletionEvidenceSource,
  deps?: SkillsDependencies,
): Promise<void> {
  const result = await database(deps).from('course_version_outline')
    .select('skills')
    .eq('version_id', completion.course_version_id)
    .maybeSingle();
  if (result.error) databaseFailure('Unable to load completed course skills');
  const skillIds = declarationIds(record(result.data)?.skills);
  for (const skillId of skillIds) {
    await recordEvidenceIndependently(
      completion.user_id,
      skillId,
      'exposed',
      'course_completion',
      'course',
      completion.course_id,
      deps,
    );
  }
}

export async function onExamPassed(
  attempt: ExamEvidenceSource,
  deps?: SkillsDependencies,
): Promise<void> {
  const skillIds = [...new Set(Object.values(attempt.gradingSnapshot.questions)
    .flatMap((question) => question.skills ?? []))];
  for (const skillId of skillIds) {
    await recordEvidenceIndependently(
      attempt.userId,
      skillId,
      'applied',
      'exam_passed',
      'exam_attempt',
      attempt.id,
      deps,
    );
  }
}

export async function onAssignmentApproved(
  assignment: AssignmentEvidenceSource,
  deps?: SkillsDependencies,
): Promise<void> {
  for (const skillId of new Set(assignment.skills)) {
    await recordEvidenceIndependently(
      assignment.userId,
      skillId,
      'demonstrated',
      'assignment_approved',
      'assignment_submission',
      assignment.submissionId,
      deps,
    );
  }
}

function levelOf(value: unknown): SkillLevel | null {
  return (SKILL_LEVELS as readonly unknown[]).includes(value) ? value as SkillLevel : null;
}

function evidenceTypeOf(value: unknown): SkillEvidenceType | null {
  return (SKILL_EVIDENCE_TYPES as readonly unknown[]).includes(value)
    ? value as SkillEvidenceType
    : null;
}

function categoryOf(value: unknown): SkillCategory {
  return (SKILL_CATEGORIES as readonly unknown[]).includes(value) ? value as SkillCategory : 'other';
}

function evidenceHref(refType: string, refId: string): string | null {
  if (refType === 'course') return routes.learner.course(refId);
  if (refType === 'project') return routes.learner.project(refId);

  const id = encodeURIComponent(refId);
  switch (refType) {
    case 'exam_attempt': return `/exams/attempts/${id}/review`;
    case 'assignment_submission': return `/assignments/submissions/${id}`;
    default: return null;
  }
}

function passportEvidence(value: Record<string, unknown>): PassportEvidence | null {
  const level = levelOf(value.level);
  const evidenceType = evidenceTypeOf(value.evidence_type);
  if (
    typeof value.id !== 'string'
    || !level
    || !evidenceType
    || typeof value.ref_type !== 'string'
    || typeof value.ref_id !== 'string'
    || typeof value.created_at !== 'string'
  ) return null;
  return {
    id: value.id,
    level,
    evidenceType,
    refType: value.ref_type,
    refId: value.ref_id,
    createdAt: value.created_at,
    href: evidenceHref(value.ref_type, value.ref_id),
  };
}

const LEVEL_RANK: Record<SkillLevel, number> = {
  exposed: 0,
  applied: 1,
  demonstrated: 2,
};

/** Builds a learner's passport with one highest-level row per evidenced skill. */
export async function passport(userId: string, deps?: SkillsDependencies): Promise<PassportSkill[]> {
  const client = database(deps);
  const evidenceResult = await client.from('skill_evidence')
    .select('id,skill_id,level,evidence_type,ref_type,ref_id,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (evidenceResult.error) databaseFailure('Unable to load skill evidence');
  const evidenceRows = rows(evidenceResult.data);
  const skillIds = [...new Set(evidenceRows.flatMap((evidence) => (
    typeof evidence.skill_id === 'string' ? [evidence.skill_id] : []
  )))];
  if (!skillIds.length) return [];

  const skillsResult = await client.from('skills')
    .select('id,name,category')
    .in('id', skillIds);
  if (skillsResult.error) databaseFailure('Unable to load skills');
  const skillRows = new Map(rows(skillsResult.data).flatMap((skill) => (
    typeof skill.id === 'string' ? [[skill.id, skill] as const] : []
  )));

  return skillIds.flatMap((skillId): PassportSkill[] => {
    const skill = skillRows.get(skillId);
    const name = skillName(skill?.name);
    if (!skill || !name) return [];
    const evidence = evidenceRows.flatMap((row) => (
      row.skill_id === skillId ? passportEvidence(row) ?? [] : []
    ));
    if (!evidence.length) return [];
    const level = evidence.reduce((highest, item) => (
      LEVEL_RANK[item.level] > LEVEL_RANK[highest] ? item.level : highest
    ), evidence[0].level);
    return [{
      id: skillId,
      name,
      category: categoryOf(skill.category),
      level,
      evidence,
    }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}
