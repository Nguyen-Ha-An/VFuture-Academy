import { z } from 'zod';
import { ID_PATTERN } from '../schema/common';
import { AssignmentDocumentSchema } from '../schema/bundle';
import {
  AssignmentBlockSchema, FlashcardsBlockSchema, NextStepBlockSchema,
  OpportunityLinkBlockSchema, QuizBlockSchema, QuizSettingsSchema,
  ReflectionBlockSchema, ResourceLinkBlockSchema, SubmissionSpecSchema,
  containerSchemas,
} from '../schema/activities';
import { ExamDocumentSchema, ExamSectionSchema, ExamSettingsSchema } from '../schema/exam';
import { LessonDocumentSchema } from '../schema/lesson';
import { BLOCK_MANIFEST } from '../manifest/blocks';
import { UPLOAD_EXTENSIONS_BY_MIME } from '../schema/uploads';
import type { AuthoringKind, ProfileContext } from './context';
import { buildAuthoringContent } from './content';
import { buildAuthoringQuestions } from './questions';

const LINK_HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
// Excluding ports and credentials keeps this expressible in both Zod's URL
// parser and the published JSON Schema's regex/uri checks.
const HTTPS_URL_PATTERN = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/[^\s]*)?$/;

type Content = ReturnType<typeof buildAuthoringContent>;
type Questions = ReturnType<typeof buildAuthoringQuestions>;

const knownIds = (values: readonly string[]) => [...new Set(values.filter((id) => ID_PATTERN.test(id)))].sort();

/** A selected edit target pins the document identity, including its kind. */
function documentId(ctx: ProfileContext, kind: AuthoringKind, storageId: z.ZodType) {
  if (!ctx.target) return storageId;
  return ctx.target.kind === kind && ID_PATTERN.test(ctx.target.id)
    ? z.literal(ctx.target.id)
    : z.never();
}

function buildSubmission() {
  const storage = SubmissionSpecSchema.shape;
  return z.strictObject({
    accepts: z.array(storage.accepts.element).min(1).max(4),
    maxFiles: storage.maxFiles,
    maxFileSizeMB: storage.maxFileSizeMB,
    allowedMimeTypes: z.array(z.enum(Object.keys(UPLOAD_EXTENSIONS_BY_MIME))).max(30).optional(),
    linkHosts: z.array(z.string().min(3).max(100).regex(LINK_HOST_PATTERN)).max(30).optional(),
    codeLanguage: storage.codeLanguage,
  });
}

function buildAssignmentFields(ctx: ProfileContext, content: Content, questions: Questions) {
  const storage = AssignmentBlockSchema.shape;
  const skills = knownIds(ctx.skills);
  return {
    title: content.l10nLabel,
    instructions: content.l10nRichContent,
    submission: buildSubmission(),
    rubric: questions.rubric,
    passPoints: z.number().min(0).max(1000).optional(),
    ...(skills.length ? { skills: z.array(z.enum(skills)).max(10).optional() } : {}),
    resubmission: storage.resubmission,
    required: storage.required,
  };
}

function buildQuizSettings() {
  const storage = QuizSettingsSchema.shape;
  const common = {
    attemptsAllowed: storage.attemptsAllowed,
    feedback: storage.feedback,
    showExplanations: storage.showExplanations,
    shuffleQuestions: storage.shuffleQuestions,
    required: storage.required,
  };
  return z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('practice'), ...common }),
    z.strictObject({ mode: z.literal('graded'), ...common, passPercent: storage.passPercent }),
  ]);
}

function buildExamSettings() {
  const storage = ExamSettingsSchema.shape;
  const availability = storage.availability.unwrap().shape;
  const review = storage.review.unwrap().shape;
  const integrity = storage.integrity.unwrap().shape;
  return z.strictObject({
    timeLimitMinutes: storage.timeLimitMinutes,
    attemptsAllowed: storage.attemptsAllowed,
    scoringPolicy: storage.scoringPolicy,
    availability: z.strictObject({
      openAt: availability.openAt,
      closeAt: availability.closeAt,
      lateSubmission: availability.lateSubmission,
    }).optional(),
    passPercent: storage.passPercent,
    review: z.strictObject({
      showScore: review.showScore,
      showCorrectAnswers: review.showCorrectAnswers,
      showExplanations: review.showExplanations,
      releaseAt: review.releaseAt.unwrap().unwrap().optional(),
    }).optional(),
    shuffleQuestions: storage.shuffleQuestions,
    shuffleOptions: storage.shuffleOptions,
    navigation: storage.navigation,
    layout: storage.layout,
    integrity: z.strictObject({
      logFocusLoss: integrity.logFocusLoss,
      logPaste: integrity.logPaste,
      requireFullscreen: integrity.requireFullscreen,
    }).optional(),
    required: storage.required,
  });
}

function buildLessonBlocks(ctx: ProfileContext, content: Content, questions: Questions) {
  const quizStorage = QuizBlockSchema.shape;
  const quiz = z.strictObject({
    id: quizStorage.id,
    type: quizStorage.type,
    title: content.l10nLabel.optional(),
    intro: content.l10nRichContent.optional(),
    questions: z.array(questions.quizEntry).min(1).max(50),
    settings: buildQuizSettings(),
  });
  const assignment = z.strictObject({
    id: AssignmentBlockSchema.shape.id,
    type: AssignmentBlockSchema.shape.type,
    ...buildAssignmentFields(ctx, content, questions),
  });
  const reflectionStorage = ReflectionBlockSchema.shape;
  const reflection = z.strictObject({
    id: reflectionStorage.id,
    type: reflectionStorage.type,
    prompt: content.l10nRichContent,
    required: reflectionStorage.required,
    minChars: reflectionStorage.minChars.unwrap().max(20000).optional(),
    maxChars: reflectionStorage.maxChars,
  });
  const flashcardsStorage = FlashcardsBlockSchema.shape;
  const card = flashcardsStorage.cards.element.shape;
  const flashcards = z.strictObject({
    id: flashcardsStorage.id,
    type: flashcardsStorage.type,
    cards: z.array(z.strictObject({
      id: card.id,
      front: content.l10nRichContent,
      back: content.l10nRichContent,
    })).min(1).max(100),
    shuffle: flashcardsStorage.shuffle,
  });
  const nextStepStorage = NextStepBlockSchema.shape;
  const targetVariants: z.core.$ZodTypeDiscriminable[] = [
    z.strictObject({ kind: z.literal('url'), url: z.url().regex(HTTPS_URL_PATTERN) }),
  ];
  const lessonTargets = knownIds(ctx.itemTargets.lesson);
  const examTargets = knownIds(ctx.itemTargets.exam);
  if (lessonTargets.length) targetVariants.push(z.strictObject({ kind: z.literal('lesson'), id: z.enum(lessonTargets) }));
  if (examTargets.length) targetVariants.push(z.strictObject({ kind: z.literal('exam'), id: z.enum(examTargets) }));
  const nextStep = z.strictObject({
    id: nextStepStorage.id,
    type: nextStepStorage.type,
    title: content.l10nLabel,
    description: content.l10nLabel.optional(),
    target: z.discriminatedUnion('kind', targetVariants as [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]]),
  });
  const resourceIds = knownIds(ctx.resourceIds);
  const opportunityIds = knownIds(ctx.opportunityIds);
  const resourceLink = resourceIds.length ? z.strictObject({
    id: ResourceLinkBlockSchema.shape.id,
    type: ResourceLinkBlockSchema.shape.type,
    resourceId: z.enum(resourceIds),
    label: content.l10nLabel.optional(),
    required: ResourceLinkBlockSchema.shape.required,
  }) : undefined;
  const opportunityLink = opportunityIds.length ? z.strictObject({
    id: OpportunityLinkBlockSchema.shape.id,
    type: OpportunityLinkBlockSchema.shape.type,
    opportunityId: z.enum(opportunityIds),
    relationship: OpportunityLinkBlockSchema.shape.relationship,
  }) : undefined;

  const activitySchemas = {
    quiz, assignment, reflection, flashcards,
    resource_link: resourceLink, opportunity_link: opportunityLink, next_step: nextStep,
  };
  const activityOptions = BLOCK_MANIFEST.filter((block) => block.renderable && block.category === 'activity')
    .flatMap((block) => {
      if (!(block.type in activitySchemas)) throw new Error(`Missing authoring schema for activity ${block.type}`);
      const schema = activitySchemas[block.type as keyof typeof activitySchemas];
      return schema ? [schema] : [];
    });
  const leafOptions = [...content.lessonContentLeafBlock.options, ...activityOptions] as
    [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]];
  const leafBlock = z.discriminatedUnion('type', leafOptions);

  // Only the outermost lesson level may contain a container. Callout children
  // are content leaves; the other containers may hold any lesson leaf.
  const storageContainers = containerSchemas(z.never());
  const titled = z.strictObject({
    id: storageContainers.accordion.shape.items.element.shape.id,
    title: content.l10nLabel,
    blocks: z.array(leafBlock).min(1).max(100),
  });
  const accordion = z.strictObject({
    id: storageContainers.accordion.shape.id,
    type: storageContainers.accordion.shape.type,
    items: z.array(titled).min(1).max(30),
    allowMultipleOpen: storageContainers.accordion.shape.allowMultipleOpen,
  });
  const tabs = z.strictObject({
    id: storageContainers.tabs.shape.id,
    type: storageContainers.tabs.shape.type,
    items: z.array(titled).min(1).max(12),
  });
  const reveal = z.strictObject({
    id: storageContainers.reveal.shape.id,
    type: storageContainers.reveal.shape.type,
    label: content.l10nLabel,
    blocks: z.array(leafBlock).min(1).max(100),
  });
  const stepper = z.strictObject({
    id: storageContainers.stepper.shape.id,
    type: storageContainers.stepper.shape.type,
    steps: z.array(titled).min(1).max(30),
    linear: storageContainers.stepper.shape.linear,
  });
  const containers = {
    callout: content.makeLessonCallout(content.lessonContentLeafBlock),
    accordion, tabs, reveal, stepper,
  };
  const containerOptions = BLOCK_MANIFEST.filter((block) => block.renderable && block.category === 'container')
    .map((block) => {
      if (!(block.type in containers)) throw new Error(`Missing authoring schema for container ${block.type}`);
      return containers[block.type as keyof typeof containers];
    });
  const block = z.discriminatedUnion('type', [...leafOptions, ...containerOptions] as
    [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]]);
  return { block, leafBlock };
}

/** Build the three strict item-document schemas for a specific course context. */
export function buildAuthoringDocuments(ctx: ProfileContext) {
  const content = buildAuthoringContent(ctx);
  const questions = buildAuthoringQuestions(ctx, content);
  const lessonBlocks = buildLessonBlocks(ctx, content, questions);
  const lessonStorage = LessonDocumentSchema.shape;
  const examStorage = ExamDocumentSchema.shape;
  const assignmentStorage = AssignmentDocumentSchema.shape;
  const sectionStorage = ExamSectionSchema.shape;
  const lesson = z.strictObject({
    schemaVersion: lessonStorage.schemaVersion,
    kind: lessonStorage.kind,
    id: documentId(ctx, 'lesson', lessonStorage.id),
    title: content.l10nLabel,
    summary: content.l10nLabel.optional(),
    objectives: z.array(content.l10nLabel).max(12).optional(),
    estimatedMinutes: lessonStorage.estimatedMinutes,
    completion: lessonStorage.completion,
    blocks: z.array(lessonBlocks.block).min(1).max(400),
  });
  const section = z.strictObject({
    id: sectionStorage.id,
    title: content.l10nLabel,
    instructions: content.l10nRichContent.optional(),
    questions: z.array(questions.examEntry).min(1).max(200),
  });
  const exam = z.strictObject({
    schemaVersion: examStorage.schemaVersion,
    kind: examStorage.kind,
    id: documentId(ctx, 'exam', examStorage.id),
    title: content.l10nLabel,
    description: content.l10nRichContent.optional(),
    settings: buildExamSettings().optional(),
    sections: z.array(section).min(1).max(20),
  });
  const assignment = z.strictObject({
    schemaVersion: assignmentStorage.schemaVersion,
    kind: assignmentStorage.kind,
    id: documentId(ctx, 'assignment', assignmentStorage.id),
    ...buildAssignmentFields(ctx, content, questions),
  });
  return { lesson, exam, assignment };
}
