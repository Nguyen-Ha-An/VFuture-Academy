import type { RichContent } from '../../schema/types';
import type { LearnerQuestion } from '../registry';
export interface LearnerOption { id: string; content: RichContent }
export type ChoiceQuestion = LearnerQuestion & { options: LearnerOption[]; minSelections?: number; maxSelections?: number };
export type TrueFalseQuestion = LearnerQuestion & { labels?: { true: string; false: string } };
export type FillBlankQuestion = LearnerQuestion & { content: RichContent; blanks: { id: string; options?: string[]; width?: 'sm' | 'md' | 'lg' }[]; wordBank?: { id: string; text: string }[] };
export type ShortAnswerQuestion = LearnerQuestion & { maxLength?: number };
export type NumericQuestion = LearnerQuestion & { unit?: string; precision?: number };
export type EssayQuestion = LearnerQuestion & { prompts?: string[]; minWords?: number; maxWords?: number; rubric?: { criteria: { id: string; name: string; description?: string; maxPoints: number }[] } };
export type MatchingQuestion = LearnerQuestion & { left: LearnerOption[]; right: LearnerOption[]; allowManyToOne?: boolean };
export type OrderingQuestion = LearnerQuestion & { items: LearnerOption[]; slots?: { id: string; label: string }[] };
export type ClassificationQuestion = LearnerQuestion & { categories: { id: string; label: string }[]; items: LearnerOption[] };
export type UploadAnswerQuestion = LearnerQuestion & { accepts: ('file' | 'link' | 'text')[]; allowedMimeTypes?: string[]; maxFiles?: number; maxFileSizeMB?: number; linkHosts?: string[]; rubric?: EssayQuestion['rubric'] };
export type CodeAnswerQuestion = LearnerQuestion & { language: string; starterCode?: string; minLines?: number; rubric?: EssayQuestion['rubric'] };
export type GroupQuestion = LearnerQuestion & { sharedContent: RichContent; questions: LearnerQuestion[] };
export const t = (locale: 'vi' | 'en', vi: string, en: string) => (locale === 'vi' ? vi : en);
