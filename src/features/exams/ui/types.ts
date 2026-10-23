import type { LearnerItem } from '../../../content-engine/compile';
import type { ExamGradingSettings } from '../../../content-engine/compile/normalize';
import type { LearnerQuestion } from '../../../content-engine/render/registry';
import type { RichContent } from '../../../content-engine/schema/types';

export interface ExamSection {
  id: string;
  title: string;
  instructions?: RichContent;
  timeLimitMinutes?: number;
  questions: LearnerQuestion[];
}

export type LearnerExam = LearnerItem & {
  kind: 'exam';
  description?: RichContent;
  settings: ExamGradingSettings;
  sections: ExamSection[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLearnerQuestion(value: unknown): value is LearnerQuestion {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.type === 'string'
    && value.type.length > 0;
}

function isExamSection(value: unknown): value is ExamSection {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || value.id.length === 0
    || typeof value.title !== 'string'
    || !Array.isArray(value.questions)
    || !value.questions.every(isLearnerQuestion)) {
    return false;
  }
  if (value.timeLimitMinutes !== undefined
    && (typeof value.timeLimitMinutes !== 'number'
      || !Number.isFinite(value.timeLimitMinutes)
      || value.timeLimitMinutes < 0)) {
    return false;
  }
  return value.instructions === undefined
    || (isRecord(value.instructions) && Array.isArray(value.instructions.blocks));
}

export function examSections(value: unknown): ExamSection[] {
  if (!isRecord(value)
    || !Array.isArray(value.sections)
    || !value.sections.every(isExamSection)) {
    throw new TypeError('The exam learner projection contains invalid sections.');
  }
  return value.sections;
}
