import { z } from 'zod';
import { LessonDocumentSchema } from '../schema/lesson';
import { ExamDocumentSchema, ExamSectionSchema, ExamSettingsSchema } from '../schema/exam';
import { AssignmentDocumentSchema } from '../schema/bundle';
import {
  AssignmentBlockSchema, QuizBlockSchema, QuizSettingsSchema, SubmissionSpecSchema,
  ReflectionBlockSchema, FlashcardsBlockSchema, ResourceLinkBlockSchema,
  OpportunityLinkBlockSchema, NextStepBlockSchema,
  containerSchemas,
} from '../schema/activities';

/** Each storage field needs an explicit decision when the storage schema changes. */
export type Policy = 'reuse' | 'require' | 'tighten' | 'forbid' | 'context';

const _storageContainers = containerSchemas(z.never());

export const DOCUMENT_FIELD_POLICIES = {
  lesson: {
    $schema: 'forbid', schemaVersion: 'reuse', kind: 'reuse', id: 'context',
    languages: 'forbid', defaultLanguage: 'forbid', title: 'tighten', summary: 'tighten',
    objectives: 'tighten', estimatedMinutes: 'reuse', completion: 'reuse', blocks: 'tighten',
  } satisfies Record<keyof typeof LessonDocumentSchema.shape, Policy>,
  exam: {
    $schema: 'forbid', schemaVersion: 'reuse', kind: 'reuse', id: 'context',
    languages: 'forbid', defaultLanguage: 'forbid', title: 'tighten', description: 'tighten',
    settings: 'tighten', sections: 'tighten',
  } satisfies Record<keyof typeof ExamDocumentSchema.shape, Policy>,
  assignment: {
    $schema: 'forbid', schemaVersion: 'reuse', kind: 'reuse', id: 'context',
    languages: 'forbid', defaultLanguage: 'forbid', title: 'tighten', instructions: 'tighten',
    submission: 'tighten', rubric: 'require', passPoints: 'tighten', skills: 'context',
    resubmission: 'reuse', required: 'reuse', notebook: 'forbid',
  } satisfies Record<keyof typeof AssignmentDocumentSchema.shape, Policy>,
  examSection: {
    id: 'reuse', title: 'tighten', instructions: 'tighten',
    timeLimitMinutes: 'forbid', questions: 'tighten',
  } satisfies Record<keyof typeof ExamSectionSchema.shape, Policy>,
  quizBlock: {
    id: 'require', type: 'reuse', title: 'tighten', intro: 'tighten',
    questions: 'tighten', settings: 'require',
  } satisfies Record<keyof typeof QuizBlockSchema.shape, Policy>,
  assignmentBlock: {
    type: 'reuse', id: 'reuse', title: 'tighten', instructions: 'tighten',
    submission: 'tighten', rubric: 'require', passPoints: 'tighten', skills: 'context',
    resubmission: 'reuse', required: 'reuse', notebook: 'forbid',
  } satisfies Record<keyof typeof AssignmentBlockSchema.shape, Policy>,
  examSettings: {
    timeLimitMinutes: 'reuse', attemptsAllowed: 'reuse', scoringPolicy: 'reuse',
    availability: 'tighten', passPercent: 'reuse', review: 'tighten',
    shuffleQuestions: 'reuse', shuffleOptions: 'reuse', navigation: 'reuse',
    layout: 'reuse', integrity: 'reuse', required: 'reuse',
  } satisfies Record<keyof typeof ExamSettingsSchema.shape, Policy>,
  quizSettings: {
    mode: 'require', attemptsAllowed: 'reuse', feedback: 'reuse',
    showExplanations: 'reuse', shuffleQuestions: 'reuse', passPercent: 'tighten',
    required: 'reuse',
  } satisfies Record<keyof typeof QuizSettingsSchema.shape, Policy>,
  submission: {
    accepts: 'tighten', maxFiles: 'reuse', maxFileSizeMB: 'reuse',
    allowedMimeTypes: 'tighten', linkHosts: 'tighten', codeLanguage: 'tighten',
  } satisfies Record<keyof typeof SubmissionSpecSchema.shape, Policy>,
  reflection: {
    id: 'reuse', type: 'reuse', prompt: 'tighten', required: 'reuse',
    minChars: 'tighten', maxChars: 'reuse',
  } satisfies Record<keyof typeof ReflectionBlockSchema.shape, Policy>,
  flashcards: {
    id: 'reuse', type: 'reuse', cards: 'tighten', shuffle: 'reuse',
  } satisfies Record<keyof typeof FlashcardsBlockSchema.shape, Policy>,
  resourceLink: {
    id: 'reuse', type: 'reuse', resourceId: 'context', label: 'tighten', required: 'reuse',
  } satisfies Record<keyof typeof ResourceLinkBlockSchema.shape, Policy>,
  opportunityLink: {
    id: 'reuse', type: 'reuse', opportunityId: 'context', relationship: 'reuse',
  } satisfies Record<keyof typeof OpportunityLinkBlockSchema.shape, Policy>,
  nextStep: {
    id: 'reuse', type: 'reuse', title: 'tighten', description: 'tighten', target: 'context',
  } satisfies Record<keyof typeof NextStepBlockSchema.shape, Policy>,
  accordion: {
    id: 'reuse', type: 'reuse', items: 'tighten', allowMultipleOpen: 'reuse',
  } satisfies Record<keyof typeof _storageContainers.accordion.shape, Policy>,
  tabs: {
    id: 'reuse', type: 'reuse', items: 'tighten',
  } satisfies Record<keyof typeof _storageContainers.tabs.shape, Policy>,
  reveal: {
    id: 'reuse', type: 'reuse', label: 'tighten', blocks: 'tighten',
  } satisfies Record<keyof typeof _storageContainers.reveal.shape, Policy>,
  stepper: {
    id: 'reuse', type: 'reuse', steps: 'tighten', linear: 'reuse',
  } satisfies Record<keyof typeof _storageContainers.stepper.shape, Policy>,
} as const;
