import { ExamError, type ExamAttemptRecord } from './types';

export type SequentialExamProgress = {
  index: number;
  count: number;
  questionOffset: number;
  questionCount: number;
  /** Zero-based positions only. Locked pages do not disclose their questions. */
  answeredBefore: number[];
};

export function hasExamAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some(hasExamAnswer);
  return true;
}

/** Page boundaries use the pinned, post-draw question order, including whole question groups. */
export function sequentialPage(attempt: ExamAttemptRecord) {
  const settings = attempt.gradingSnapshot?.exam;
  if (settings?.navigation !== 'sequential' || settings.layout === 'single_page') return null;
  const sections = attempt.questionSet.sections;
  const allIds = sections.flatMap(section => section.questionIds);
  const sectionLayout = settings.layout === 'section_per_page';
  const count = sectionLayout ? sections.length : allIds.length;
  const index = attempt.sequentialStep;
  if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
    throw new ExamError('INVALID_EXAM_CONFIGURATION', 'The pinned sequential exam page is unavailable.');
  }
  const section = sectionLayout ? sections[index] : sections.find(entry => entry.questionIds.includes(allIds[index]));
  const questionIds = sectionLayout ? section?.questionIds : [allIds[index]];
  if (!section || !questionIds?.length) {
    throw new ExamError('INVALID_EXAM_CONFIGURATION', 'The pinned sequential exam page is empty.');
  }
  const questionOffset = sectionLayout ? allIds.indexOf(questionIds[0]) : index;
  return {
    index, count, questionOffset, questionCount: allIds.length,
    sectionId: section.id, questionIds, previousIds: allIds.slice(0, questionOffset),
  };
}
