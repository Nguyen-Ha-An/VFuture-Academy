import type { GradingItem, GradingQuestion } from '../../content-engine/compile';
import type { Locale } from '../../content-engine/schema/common';
import { seededShuffle } from '../../content-engine/render/shuffle';
import {
  ExamError,
  type BankQuestionSnapshot,
  type BankSource,
} from './types';

type ExamSections = NonNullable<GradingItem['exam']>['sections'];

export interface DrawnPoolQuestion {
  poolId: string;
  sourceId: string;
  id: string;
  versionId: string;
  grading: GradingQuestion;
  renders: Record<Locale, unknown>;
}

export type DrawnPools = Record<string, DrawnPoolQuestion[]>;

const rawId = (id: string) => id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;

function rebaseGrading(
  grading: GradingQuestion,
  id: string,
  pointsEach?: number,
  parentId?: string,
): GradingQuestion {
  const oldId = grading.id;
  const children = grading.children?.map((child) => {
    const suffix = child.id.startsWith(`${oldId}/`) ? child.id.slice(oldId.length + 1) : rawId(child.id);
    return rebaseGrading(child, `${id}/${suffix}`, undefined, id);
  });
  return {
    ...structuredClone(grading),
    id,
    ...(pointsEach !== undefined ? { points: pointsEach } : {}),
    ...(parentId ? { parentId } : {}),
    ...(children ? { children } : {}),
  };
}

function rebaseRender(render: unknown, id: string, pointsEach?: number): unknown {
  if (typeof render !== 'object' || render === null || Array.isArray(render)) return structuredClone(render);
  const cloned = structuredClone(render) as Record<string, unknown>;
  const oldId = typeof cloned.id === 'string' ? cloned.id : undefined;
  cloned.id = id;
  if (pointsEach !== undefined) cloned.points = pointsEach;
  if (Array.isArray(cloned.questions)) {
    cloned.questions = cloned.questions.map((child) => {
      const childId = typeof child === 'object' && child !== null && typeof (child as { id?: unknown }).id === 'string'
        ? (child as { id: string }).id
        : '';
      const suffix = oldId && childId.startsWith(`${oldId}/`) ? childId.slice(oldId.length + 1) : rawId(childId);
      return rebaseRender(child, `${id}/${suffix}`);
    });
  }
  return cloned;
}

function drawQuestion(
  sectionId: string,
  poolId: string,
  snapshot: BankQuestionSnapshot,
  pointsEach?: number,
): DrawnPoolQuestion {
  const id = `${sectionId}/${snapshot.id}`;
  return {
    poolId,
    sourceId: snapshot.id,
    id,
    versionId: snapshot.versionId,
    grading: rebaseGrading(snapshot.grading, id, pointsEach),
    renders: Object.fromEntries(
      Object.entries(snapshot.renders).map(([locale, render]) => [locale, rebaseRender(render, id, pointsEach)]),
    ) as Record<Locale, unknown>,
  };
}

export async function drawPools(
  sections: ExamSections,
  bankSource: BankSource,
  seed: string,
  excludeIds: readonly string[] = [],
): Promise<DrawnPools> {
  const globallyExcluded = new Set(excludeIds.flatMap((id) => [id, rawId(id)]));
  const used = new Set([
    ...globallyExcluded,
    ...sections.flatMap((section) => section.questionIds.flatMap((id) => [id, rawId(id)])),
  ]);
  const result: DrawnPools = Object.fromEntries(sections.map((section) => [section.id, []]));

  for (const section of sections) {
    for (const pool of section.pools) {
      const listed = await bankSource.listPublished(
        pool.from ? { from: pool.from } : { filter: pool.filter! },
      );
      const candidates = [...new Map(
        listed
          .filter((question) => !used.has(question.id) && !used.has(`${section.id}/${question.id}`))
          .map((question) => [question.id, question]),
      ).values()].sort((a, b) => a.id.localeCompare(b.id));

      if (candidates.length < pool.count) {
        throw new ExamError(
          'POOL_UNSATISFIABLE',
          `Pool "${pool.id}" in section "${section.id}" needs ${pool.count} questions but only ${candidates.length} are available.`,
          { sectionId: section.id, poolId: pool.id, required: pool.count, available: candidates.length },
        );
      }

      const selected = seededShuffle(candidates, `${seed}:${section.id}:${pool.id}`).slice(0, pool.count);
      for (const question of selected) {
        used.add(question.id);
        used.add(`${section.id}/${question.id}`);
        result[section.id].push(drawQuestion(section.id, pool.id, question, pool.pointsEach));
      }
    }
  }

  return result;
}
