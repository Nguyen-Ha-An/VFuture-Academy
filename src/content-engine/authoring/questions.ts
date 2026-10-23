import { z } from 'zod';
import { ID_PATTERN, IdSchema } from '../schema/common';
import {
  ClassificationSchema,
  CodeAnswerSchema,
  EssaySchema,
  FillBlankSchema,
  MatchingSchema,
  MultipleChoiceSchema,
  NumericSchema,
  OptionSchema,
  OrderingSchema,
  PairItemSchema,
  QuestionGroupSchema,
  QuestionSettingsSchema,
  RubricSchema,
  ShortAnswerSchema,
  SingleChoiceSchema,
  TrueFalseSchema,
  UploadAnswerSchema,
  type QuestionType,
  questionBaseFields,
} from '../schema/questions';
import { UPLOAD_EXTENSIONS_BY_MIME } from '../schema/uploads';
import type { ProfileContext } from './context';
import { buildAuthoringContent } from './content';
import type { Policy } from './ledger';

/** Compile-time inventory: a storage-field addition requires an authoring decision. */
const basePolicy = {
  id: 'reuse',
  points: 'require',
  content: 'tighten',
  explanation: 'require',
  hint: 'tighten',
  settings: 'tighten',
  display: 'forbid',
  selfAssessment: 'forbid',
  difficulty: 'reuse',
  tags: 'context',
  skills: 'context',
  accessibility: 'tighten',
} as const satisfies Record<keyof typeof questionBaseFields, Policy>;

const manualPolicy = {
  ...basePolicy,
  explanation: 'tighten',
  settings: 'forbid',
} as const;

export const QUESTION_FIELD_POLICIES = {
  single_choice: { ...basePolicy, type: 'reuse', options: 'tighten', correctAnswer: 'require' } satisfies Record<keyof typeof SingleChoiceSchema.shape, Policy>,
  multiple_choice: { ...basePolicy, type: 'reuse', options: 'tighten', minSelections: 'reuse', maxSelections: 'reuse', correctAnswer: 'require' } satisfies Record<keyof typeof MultipleChoiceSchema.shape, Policy>,
  true_false: { ...basePolicy, type: 'reuse', labels: 'tighten', settings: 'forbid', correctAnswer: 'require' } satisfies Record<keyof typeof TrueFalseSchema.shape, Policy>,
  fill_blank: { ...basePolicy, type: 'reuse', blanks: 'tighten', wordBank: 'forbid', correctAnswer: 'require' } satisfies Record<keyof typeof FillBlankSchema.shape, Policy>,
  short_answer: { ...basePolicy, type: 'reuse', matchMode: 'require', maxLength: 'reuse', correctAnswer: 'require' } satisfies Record<keyof typeof ShortAnswerSchema.shape, Policy>,
  numeric: { ...basePolicy, type: 'reuse', tolerance: 'tighten', tolerancePercent: 'reuse', unit: 'tighten', precision: 'reuse', correctAnswer: 'require' } satisfies Record<keyof typeof NumericSchema.shape, Policy>,
  matching: { ...basePolicy, type: 'reuse', left: 'tighten', right: 'tighten', allowManyToOne: 'reuse', correctAnswer: 'require' } satisfies Record<keyof typeof MatchingSchema.shape, Policy>,
  ordering: { ...basePolicy, type: 'reuse', items: 'tighten', slots: 'forbid', correctAnswer: 'require' } satisfies Record<keyof typeof OrderingSchema.shape, Policy>,
  classification: { ...basePolicy, type: 'reuse', categories: 'tighten', items: 'tighten', correctAnswer: 'require' } satisfies Record<keyof typeof ClassificationSchema.shape, Policy>,
  essay: { ...manualPolicy, type: 'reuse', prompts: 'tighten', minWords: 'reuse', maxWords: 'reuse', rubric: 'require', sampleAnswer: 'tighten' } satisfies Record<keyof typeof EssaySchema.shape, Policy>,
  upload_answer: { ...manualPolicy, type: 'reuse', accepts: 'reuse', allowedMimeTypes: 'tighten', maxFiles: 'reuse', maxFileSizeMB: 'reuse', linkHosts: 'tighten', rubric: 'require' } satisfies Record<keyof typeof UploadAnswerSchema.shape, Policy>,
  code_answer: { ...manualPolicy, type: 'reuse', language: 'reuse', starterCode: 'reuse', minLines: 'reuse', rubric: 'require', sampleSolution: 'reuse' } satisfies Record<keyof typeof CodeAnswerSchema.shape, Policy>,
  question_group: {
    id: 'reuse', points: 'forbid', content: 'tighten', explanation: 'forbid', hint: 'forbid',
    settings: 'forbid', display: 'forbid', selfAssessment: 'forbid', difficulty: 'forbid',
    tags: 'forbid', skills: 'forbid', accessibility: 'forbid', type: 'reuse',
    sharedContent: 'tighten', questions: 'tighten',
  } satisfies Record<keyof typeof QuestionGroupSchema.shape, Policy>,
} as const satisfies Record<QuestionType, Record<string, Policy>>;

const BANK_REF_PATTERN = /^bank:[a-z0-9][a-z0-9-]{0,63}$/;
const LINK_HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

const knownValues = (values: readonly string[], predicate: (value: string) => boolean) =>
  [...new Set(values.filter(predicate))].sort();

/** Rubric labels and positive criterion weights are stricter than storage. */
function buildRubric(content: ReturnType<typeof buildAuthoringContent>) {
  const criterion = RubricSchema.shape.criteria.element;
  const level = criterion.shape.levels.unwrap().element;
  const levels = z.array(z.strictObject({
    points: level.shape.points,
    label: content.l10nLabel,
    description: content.l10nLabel.optional(),
  })).min(2).max(6);
  const criteria = z.array(z.strictObject({
    id: criterion.shape.id,
    name: content.l10nLabel,
    description: content.l10nLabel.optional(),
    maxPoints: z.number().positive().max(100),
    levels: levels.optional(),
  })).min(1).max(12);
  return z.strictObject({ criteria });
}

export function buildAuthoringQuestions(ctx: ProfileContext, content: ReturnType<typeof buildAuthoringContent>) {
  const skills = knownValues(ctx.skills, (id) => ID_PATTERN.test(id));
  const tags = knownValues(ctx.tagWhitelist, (tag) => tag.length >= 1 && tag.length <= 40);
  const refs = knownValues(ctx.bankRefs, (ref) => BANK_REF_PATTERN.test(ref));
  const skillField = skills.length ? { skills: z.array(z.enum(skills)).max(10).optional() } : {};
  const tagField = tags.length ? { tags: z.array(z.enum(tags)).max(20).optional() } : {};
  const rubric = buildRubric(content);

  const option = z.strictObject({
    id: OptionSchema.shape.id,
    content: content.questionRichContent,
    feedback: content.questionRichContent.optional(),
  });
  const pairItem = z.strictObject({
    id: PairItemSchema.shape.id,
    content: content.questionRichContent,
  });
  const settings = QuestionSettingsSchema.shape;
  const singleSettings = z.strictObject({ shuffleOptions: settings.shuffleOptions }).optional();
  const multipleSettings = z.strictObject({
    shuffleOptions: settings.shuffleOptions,
    partialScoring: settings.partialScoring,
  }).optional();
  const fillSettings = z.strictObject({
    caseSensitive: settings.caseSensitive,
    ignoreAccents: settings.ignoreAccents,
    partialScoring: settings.partialScoring,
  }).optional();
  const shortSettings = z.strictObject({
    caseSensitive: settings.caseSensitive,
    ignoreAccents: settings.ignoreAccents,
  }).optional();
  const numericSettings = z.strictObject({ decimalComma: settings.decimalComma }).optional();
  const structureSettings = z.strictObject({ partialScoring: settings.partialScoring }).optional();

  const common = (shape: Pick<typeof SingleChoiceSchema.shape, 'id' | 'difficulty'>, manual = false) => ({
    id: shape.id,
    points: z.number().positive().max(1000),
    content: content.questionRichContent,
    explanation: manual ? content.questionRichContent.optional() : content.questionRichContent,
    hint: content.questionRichContent.optional(),
    difficulty: shape.difficulty,
    ...tagField,
    ...skillField,
    accessibility: z.strictObject({ transcript: content.l10nLabel.optional() }).optional(),
  });

  const single_choice = z.strictObject({
    ...common(SingleChoiceSchema.shape),
    type: SingleChoiceSchema.shape.type,
    settings: singleSettings,
    options: z.array(option).min(2).max(10),
    correctAnswer: IdSchema,
  });
  const multiple_choice = z.strictObject({
    ...common(MultipleChoiceSchema.shape),
    type: MultipleChoiceSchema.shape.type,
    settings: multipleSettings,
    options: z.array(option).min(2).max(12),
    minSelections: MultipleChoiceSchema.shape.minSelections,
    maxSelections: MultipleChoiceSchema.shape.maxSelections,
    correctAnswer: z.array(IdSchema).min(1).max(12),
  });
  const true_false = z.strictObject({
    ...common(TrueFalseSchema.shape),
    type: TrueFalseSchema.shape.type,
    labels: z.strictObject({ true: content.l10nLabel, false: content.l10nLabel }).optional(),
    correctAnswer: z.boolean(),
  });
  const fill_blank = z.strictObject({
    ...common(FillBlankSchema.shape),
    type: FillBlankSchema.shape.type,
    content: content.fillBlankContent,
    settings: fillSettings,
    blanks: z.array(z.strictObject({
      id: FillBlankSchema.shape.blanks.element.shape.id,
      width: FillBlankSchema.shape.blanks.element.shape.width,
    })).min(1).max(30),
    correctAnswer: z.record(IdSchema, z.array(z.string().min(1).max(200)).min(1).max(20)),
  });
  const short_answer = z.strictObject({
    ...common(ShortAnswerSchema.shape),
    type: ShortAnswerSchema.shape.type,
    settings: shortSettings,
    matchMode: z.enum(['exact', 'contains']),
    maxLength: ShortAnswerSchema.shape.maxLength,
    correctAnswer: ShortAnswerSchema.shape.correctAnswer.unwrap(),
  });
  const numeric = z.strictObject({
    ...common(NumericSchema.shape),
    type: NumericSchema.shape.type,
    settings: numericSettings,
    tolerance: z.number().min(0).max(1_000_000).optional(),
    tolerancePercent: NumericSchema.shape.tolerancePercent,
    unit: content.l10nLabel.optional(),
    precision: NumericSchema.shape.precision,
    correctAnswer: NumericSchema.shape.correctAnswer.unwrap(),
  });
  const matching = z.strictObject({
    ...common(MatchingSchema.shape),
    type: MatchingSchema.shape.type,
    settings: structureSettings,
    left: z.array(pairItem).min(2).max(15),
    right: z.array(pairItem).min(2).max(20),
    allowManyToOne: MatchingSchema.shape.allowManyToOne,
    correctAnswer: z.array(z.strictObject({ left: IdSchema, right: IdSchema })).min(1).max(30),
  });
  const ordering = z.strictObject({
    ...common(OrderingSchema.shape),
    type: OrderingSchema.shape.type,
    settings: structureSettings,
    items: z.array(pairItem).min(2).max(15),
    correctAnswer: z.array(IdSchema).min(2).max(15),
  });
  const classification = z.strictObject({
    ...common(ClassificationSchema.shape),
    type: ClassificationSchema.shape.type,
    settings: structureSettings,
    categories: z.array(z.strictObject({
      id: ClassificationSchema.shape.categories.element.shape.id,
      label: content.l10nLabel,
    })).min(2).max(8),
    items: z.array(pairItem).min(2).max(30),
    correctAnswer: z.record(IdSchema, IdSchema),
  });
  const essay = z.strictObject({
    ...common(EssaySchema.shape, true),
    type: EssaySchema.shape.type,
    prompts: z.array(content.l10nLabel).min(1).max(10).optional(),
    minWords: EssaySchema.shape.minWords,
    maxWords: EssaySchema.shape.maxWords,
    rubric,
    sampleAnswer: content.questionRichContent.optional(),
  });
  const upload_answer = z.strictObject({
    ...common(UploadAnswerSchema.shape, true),
    type: UploadAnswerSchema.shape.type,
    accepts: UploadAnswerSchema.shape.accepts,
    allowedMimeTypes: z.array(z.enum(Object.keys(UPLOAD_EXTENSIONS_BY_MIME))).max(20).optional(),
    maxFiles: UploadAnswerSchema.shape.maxFiles,
    maxFileSizeMB: UploadAnswerSchema.shape.maxFileSizeMB,
    linkHosts: z.array(z.string().min(3).max(100).regex(LINK_HOST_PATTERN)).max(20).optional(),
    rubric,
  });
  const code_answer = z.strictObject({
    ...common(CodeAnswerSchema.shape, true),
    type: CodeAnswerSchema.shape.type,
    language: CodeAnswerSchema.shape.language,
    starterCode: CodeAnswerSchema.shape.starterCode,
    minLines: CodeAnswerSchema.shape.minLines,
    rubric,
    sampleSolution: CodeAnswerSchema.shape.sampleSolution,
  });

  const autoLeaves = [single_choice, multiple_choice, true_false, fill_blank, short_answer, numeric, matching, ordering, classification] as const;
  const allLeaves = [...autoLeaves, essay, upload_answer, code_answer] as const;
  const autoLeaf = z.discriminatedUnion('type', autoLeaves);
  const leaf = z.discriminatedUnion('type', allLeaves);
  const groupFields = {
    id: QuestionGroupSchema.shape.id,
    type: QuestionGroupSchema.shape.type,
    content: content.questionRichContent.optional(),
    sharedContent: content.questionRichContent,
  };
  const quizGroup = z.strictObject({ ...groupFields, questions: z.array(autoLeaf).min(1).max(20) });
  const examGroup = z.strictObject({ ...groupFields, questions: z.array(leaf).min(1).max(20) });
  const quizQuestion = z.discriminatedUnion('type', [...autoLeaves, quizGroup]);
  const examQuestion = z.discriminatedUnion('type', [...allLeaves, examGroup]);
  const questionRef = refs.length ? z.strictObject({ $ref: z.enum(refs) }) : null;
  const quizEntry = questionRef ? z.xor([quizQuestion, questionRef]) : quizQuestion;
  const examEntry = questionRef ? z.xor([examQuestion, questionRef]) : examQuestion;

  const byType = {
    single_choice, multiple_choice, true_false, fill_blank, short_answer, numeric,
    matching, ordering, classification, essay, upload_answer, code_answer,
    question_group: examGroup,
  } satisfies Record<QuestionType, z.ZodType>;

  return {
    byType, quizEntry, examEntry, quizQuestion, examQuestion, quizGroup, examGroup,
    autoLeaf, leaf, questionRef, option, pairItem, rubric,
  };
}
