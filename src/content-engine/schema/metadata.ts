import { z } from 'zod';
import { HttpsUrlSchema, IdSchema, L10nStringSchema, LocaleSchema, MediaRefSchema } from './common';
import { AnnotationsSchema, BlankRunSchema, RunsSchema, TextRunSchema } from './inline';
import { ContentBlockSchema, L10nRichContentSchema, ListItemSchema, RichContentSchema } from './rich-content';
import {
  ClassificationSchema, CodeAnswerSchema, DisplaySchema, EssaySchema, ExamQuestionEntrySchema, FillBlankSchema,
  LeafQuestionSchema, MatchingSchema, MultipleChoiceSchema, NumericSchema, OptionSchema, OrderingSchema,
  PairItemSchema, PoolDrawSchema, QuestionGroupSchema, QuestionRefSchema, QuestionSchema, QuestionSettingsSchema,
  QuizQuestionEntrySchema, RubricSchema, ShortAnswerSchema, SingleChoiceSchema, TrueFalseSchema, UploadAnswerSchema,
  questionBaseFields,
} from './questions';
import {
  AssignmentBlockSchema, FlashcardsBlockSchema, NextStepBlockSchema, OpportunityLinkBlockSchema, QuizBlockSchema,
  QuizSettingsSchema, ReflectionBlockSchema, ResourceLinkBlockSchema, SubmissionSpecSchema,
} from './activities';
import { LessonBlockSchema, LessonDocumentSchema } from './lesson';
import { ExamDocumentSchema, ExamSectionSchema, ExamSettingsSchema } from './exam';
import { CompletionRuleSchema, CourseAccessSchema, CourseDocumentSchema, ManifestItemSchema, ModuleSchema } from './course';
import { AssignmentDocumentSchema, QuestionBundleSchema, ResourceDocumentSchema } from './bundle';
import { NotebookAssignmentSchema, NotebookDatasetSchema } from './notebook';

/**
 * Documentation for the exported JSON Schema, kept apart from the validators.
 *
 * The generated schema is what an author — or the AI an author briefs — reads to learn
 * the format. Without names and descriptions it exports as `__schema57` with no hint of
 * what goes inside, and the authoring guide has to carry a list of banned field names
 * instead. Metadata lives in its own registry so no validator instance is cloned or
 * altered: validation behaviour is exactly what the schema files define.
 *
 * Only singleton schema instances may carry an `id`. A field-level description is
 * attached to the field's own instance, and the helpers refuse to describe an instance
 * that is shared with a named definition — that would silently rename it.
 */
export const SCHEMA_METADATA = z.registry<z.core.JSONSchemaMeta>();

const RICH_TEMPLATE = '{"blocks":[{"type":"paragraph","content":[{"text":"…"}]}]}';

function define(schema: z.core.$ZodType, id: string, description: string): void {
  const existing = SCHEMA_METADATA.get(schema);
  if (existing?.id && existing.id !== id) throw new Error(`schema already named ${existing.id}; cannot also be ${id}`);
  SCHEMA_METADATA.add(schema, { id, description });
}

/** Describes one field of an object schema. Refuses a field whose instance is a named definition. */
function field<S extends z.ZodObject>(object: S, key: keyof S['shape'] & string, description: string): void {
  const schema = object.shape[key] as z.core.$ZodType;
  const existing = SCHEMA_METADATA.get(schema);
  if (existing?.id) throw new Error(`${String(key)} is the shared definition ${existing.id}; describe the definition instead`);
  SCHEMA_METADATA.add(schema, { ...existing, description });
}

// ---------------------------------------------------------------------------
// primitives and text
// ---------------------------------------------------------------------------

define(IdSchema, 'Id', 'Identifier: lowercase a-z, 0-9 and "-", 1–64 characters, starting with a letter or digit, e.g. "cau-1". Uppercase, spaces and underscores are rejected. Ids must be unique within their own list.');
define(LocaleSchema, 'Locale', 'Content language code: "vi" or "en".');
define(L10nStringSchema, 'L10nString', 'A short text: either a plain string, or a map with "vi" and/or "en" keys when the content is bilingual, e.g. "Phân số" or {"vi":"Phân số","en":"Fractions"}.');
define(HttpsUrlSchema, 'HttpsUrl', 'An absolute https:// URL.');
define(MediaRefSchema, 'MediaRef', 'A media reference: {"assetId":"…"} for an uploaded asset in the media library, or {"url":"https://…"} for an allowlisted host. Never invent an assetId.');

define(TextRunSchema, 'TextRun', 'One run of inline text: {"text":"…"} with optional "annotations" (bold, italic, link…). "text" may be a bilingual map. There is no other inline shape for plain words.');
define(BlankRunSchema, 'BlankRun', 'A blank inside a fill_blank question stem: {"blank":"<blank id>"}. The id must appear in the question\'s "blanks" list and in its "correctAnswer".');
define(RunsSchema, 'Runs', 'The inline content of a paragraph, heading, quote, list item or table cell: an array of TextRun (and, in fill_blank stems only, BlankRun). It is an array of objects, never a bare string.');
define(ListItemSchema, 'ListItem', 'One list entry: {"content":<Runs>} with optional nested "items" for a sub-list. "content" is an array of TextRun objects, not a string.');
define(AnnotationsSchema, 'Annotations', 'Inline formatting flags for one TextRun. Omit when the text is plain.');

define(RichContentSchema, 'RichContent', `Formatted text, always an object with a "blocks" array. The minimal form is ${RICH_TEMPLATE}. Used for question stems, options, explanations, hints, lesson paragraphs and instructions — none of these accept a plain string.`);
define(ContentBlockSchema, 'ContentBlock', 'One block of formatted content, chosen by "type": paragraph, heading, list, quote, image, video, audio, table, code, divider, embed, pdf, callout, math or diagram. Every block type has its own required fields; a paragraph needs "content" (Runs).');
define(L10nRichContentSchema, 'L10nRichContent', `RichContent, either directly (${RICH_TEMPLATE}) or as a bilingual map {"vi":{"blocks":[…]},"en":{"blocks":[…]}}. This is the type of every "content", "explanation", "hint", "intro", "instructions" and "description" field — a plain string is rejected.`);

// ---------------------------------------------------------------------------
// question building blocks
// ---------------------------------------------------------------------------

define(OptionSchema, 'Option', 'One answer option: {"id":"a","content":<L10nRichContent>} plus optional per-option "feedback". "content" is RichContent, not a string; there is no "text", "label" or "isCorrect" field — correctness lives in the question\'s "correctAnswer".');
define(PairItemSchema, 'PairItem', 'One item in a matching, ordering or classification list: {"id":"…","content":<L10nRichContent>}.');
define(RubricSchema, 'Rubric', 'Grading rubric for manually graded questions and assignments: {"criteria":[{"id","name","maxPoints"…}]} with 1–12 criteria. Each criterion has an Id, an L10nString "name", an optional "description", "maxPoints" 0–100 and optional scoring "levels". The criteria maxPoints normally add up to the question\'s "points".');
define(QuestionSettingsSchema, 'QuestionSettings', 'Optional per-question behaviour flags (shuffleOptions, partialScoring, caseSensitive, ignoreAccents, decimalComma). Omit unless the author asked for one.');
define(DisplaySchema, 'Display', 'Optional rendering hints. Do not set "interactionType" unless a specific player was requested; the default renderer is chosen automatically.');

field(z.object(questionBaseFields), 'points', 'Points for this question, 0–1000. Defaults to 1 when omitted; the guide convention is to always set it.');
field(z.object(questionBaseFields), 'difficulty', 'Optional difficulty: exactly "easy", "medium" or "hard" (lowercase).');
field(z.object(questionBaseFields), 'selfAssessment', 'true marks an unscored self-check question. It is the only way a manually graded type (essay, upload_answer, code_answer) may appear inside a lesson quiz; do not use it to skip writing a correctAnswer on an auto-graded type.');
field(z.object(questionBaseFields), 'tags', 'Optional free-text tags, each 1–40 characters.');
field(z.object(questionBaseFields), 'skills', 'Optional skill ids declared by the course. Do not invent skill ids.');

const QUESTION_TYPES: Array<[z.ZodObject, string, string]> = [
  [SingleChoiceSchema, 'SingleChoiceQuestion', 'One correct option among 2–10 "options". Required: id, type "single_choice", content (L10nRichContent), options. correctAnswer is the id of the correct Option, e.g. "b".'],
  [MultipleChoiceSchema, 'MultipleChoiceQuestion', 'Several correct options among 2–12 "options". correctAnswer is an array of Option ids, e.g. ["a","c"]. Optional minSelections/maxSelections bound how many the learner may pick.'],
  [TrueFalseSchema, 'TrueFalseQuestion', 'A true/false statement in "content". correctAnswer is the boolean true or false (not the string "true"). Optional "labels" rename the two choices.'],
  [FillBlankSchema, 'FillBlankQuestion', 'A stem whose Runs include {"blank":"<id>"} entries, one per blank declared in "blanks". correctAnswer maps each blank id to an accepted string or array of accepted strings, e.g. {"blank-1":["Hà Nội","Ha Noi"]}.'],
  [ShortAnswerSchema, 'ShortAnswerQuestion', 'A typed short answer compared with "correctAnswer": an array of accepted strings, e.g. ["Hà Nội","Ha Noi"]. matchMode defaults to "exact"; "regex" patterns must be simple and bounded.'],
  [NumericSchema, 'NumericQuestion', 'A numeric answer. correctAnswer is a JSON number, e.g. 12.5 — no unit inside it; put the unit in "unit". Use at most one of "tolerance" or "tolerancePercent".'],
  [MatchingSchema, 'MatchingQuestion', 'Match every "left" item to a "right" item. correctAnswer is an array of {"left":"<left id>","right":"<right id>"} covering every left item; a right item may repeat only when allowManyToOne is true.'],
  [OrderingSchema, 'OrderingQuestion', 'Put "items" in the correct order. correctAnswer is the array of item ids in the correct order, containing every item exactly once.'],
  [ClassificationSchema, 'ClassificationQuestion', 'Sort "items" into "categories". correctAnswer maps every item id to a category id, e.g. {"i1":"cat-a","i2":"cat-b"}.'],
  [EssaySchema, 'EssayQuestion', 'A free-text answer graded by a teacher with a "rubric". There is no correctAnswer field — including one is rejected. Not allowed inside a lesson quiz unless selfAssessment is true.'],
  [UploadAnswerSchema, 'UploadAnswerQuestion', 'A file, link or text submission graded by a teacher with a "rubric". "accepts" lists the allowed submission kinds. No correctAnswer field. Not allowed inside a lesson quiz unless selfAssessment is true.'],
  [CodeAnswerSchema, 'CodeAnswerQuestion', 'Source code submitted for manual grading with a "rubric". "language" must be one of the listed values; optional "starterCode" and "sampleSolution" are plain strings. No correctAnswer field and no test-case fields. Not allowed inside a lesson quiz unless selfAssessment is true.'],
];
for (const [schema, id, description] of QUESTION_TYPES) define(schema, id, description);
define(QuestionGroupSchema, 'QuestionGroup', 'A shared passage ("sharedContent", L10nRichContent) followed by 1–20 sub-questions in "questions". Answers and points belong to each sub-question; a group cannot contain another group.');
define(LeafQuestionSchema, 'LeafQuestion', 'Any question type except question_group, chosen by "type".');
define(QuestionSchema, 'Question', 'Any question, chosen by its "type": single_choice, multiple_choice, true_false, fill_blank, short_answer, numeric, matching, ordering, classification, essay, upload_answer, code_answer or question_group. There is no "mcq", "multiple_select" or free-form type.');
define(QuestionRefSchema, 'QuestionRef', 'A reference to a published question-bank item: {"$ref":"bank:<question-id>"}. Only for ids that already exist in the bank; never invent one.');
define(PoolDrawSchema, 'PoolDraw', 'Draws "count" questions at random from the question bank, by explicit "from" ids or by "filter". Only for existing bank content.');
define(QuizQuestionEntrySchema, 'QuizQuestionEntry', 'One entry of a lesson quiz: an inline Question or a QuestionRef.');
define(ExamQuestionEntrySchema, 'ExamQuestionEntry', 'One entry of an exam section: an inline Question, a QuestionRef or a PoolDraw.');

for (const [schema] of QUESTION_TYPES) {
  field(schema, 'type', `Always "${(schema.shape.type as z.ZodLiteral<string>).value}".`);
}
field(SingleChoiceSchema, 'options', '2–10 Option objects with unique ids; the correct one is named by correctAnswer.');
field(SingleChoiceSchema, 'correctAnswer', 'The id of the correct Option, e.g. "b" — an existing option id, never a position number or the option text.');
field(MultipleChoiceSchema, 'options', '2–12 Option objects with unique ids.');
field(MultipleChoiceSchema, 'correctAnswer', 'Array of the correct Option ids, e.g. ["a","c"] — existing ids, no duplicates, never positions.');
field(TrueFalseSchema, 'correctAnswer', 'The boolean true or false — not a string.');
field(FillBlankSchema, 'blanks', 'Every blank used in the stem, as {"id":"blank-1"}; ids must match the {"blank":…} runs and the correctAnswer keys.');
field(FillBlankSchema, 'correctAnswer', 'Object mapping each blank id to one accepted string or an array of accepted strings.');
field(ShortAnswerSchema, 'correctAnswer', 'Array of accepted answers (1–50 strings).');
field(ShortAnswerSchema, 'matchMode', '"exact" (default), "contains" or "regex".');
field(NumericSchema, 'correctAnswer', 'The correct value as a JSON number, e.g. 12.5.');
field(MatchingSchema, 'correctAnswer', 'Array of {"left","right"} id pairs covering every left item.');
field(OrderingSchema, 'correctAnswer', 'The item ids in correct order — every item exactly once.');
field(ClassificationSchema, 'correctAnswer', 'Object mapping every item id to a category id.');
field(CodeAnswerSchema, 'language', 'Programming language of the expected answer; one of the listed values only.');
field(CodeAnswerSchema, 'starterCode', 'Optional code the learner starts from, as a plain string (use \\n for line breaks).');
field(CodeAnswerSchema, 'sampleSolution', 'Optional reference solution for the grader, as a plain string. Not shown to learners.');
field(UploadAnswerSchema, 'accepts', 'Allowed submission kinds: any of "file", "link", "text".');

// ---------------------------------------------------------------------------
// lesson blocks and activities
// ---------------------------------------------------------------------------

define(QuizSettingsSchema, 'QuizSettings', 'Behaviour of a lesson quiz block. For a practice quiz the guide uses {"mode":"practice","feedback":"after_submit","showExplanations":true}. These keys are not valid in exam settings.');
define(QuizBlockSchema, 'QuizBlock', 'A quiz inside a lesson: {"id","type":"quiz","title"?,"intro"?,"settings"?,"questions":[…]} with 1–50 entries. Only auto-graded question types are allowed (single_choice, multiple_choice, true_false, fill_blank, short_answer, numeric, matching, ordering, classification); essay, upload_answer and code_answer must go in an exam or assignment, or carry selfAssessment true.');
define(SubmissionSpecSchema, 'SubmissionSpec', 'What an assignment accepts: "accepts" is a non-empty array of "text", "link", "file", "code"; optional file/link limits.');
define(AssignmentBlockSchema, 'AssignmentBlock', 'An assignment embedded in a lesson, with "instructions" (L10nRichContent), "submission" (SubmissionSpec) and an optional "rubric".');
define(ReflectionBlockSchema, 'ReflectionBlock', 'An unscored written reflection prompt inside a lesson.');
define(FlashcardsBlockSchema, 'FlashcardsBlock', 'A deck of flashcards, each with "front" and "back" L10nRichContent.');
define(ResourceLinkBlockSchema, 'ResourceLinkBlock', 'A link to an existing published resource by id. Do not invent resource ids.');
define(OpportunityLinkBlockSchema, 'OpportunityLinkBlock', 'A link to an existing opportunity by id.');
define(NextStepBlockSchema, 'NextStepBlock', 'A "what next" pointer to a lesson, exam, course, opportunity or URL.');
define(LessonBlockSchema, 'LessonBlock', 'One block of a lesson, chosen by "type": any ContentBlock type, or an activity — quiz, assignment, reflection, flashcards, accordion, tabs, reveal, stepper, resource_link, opportunity_link, next_step.');

// ---------------------------------------------------------------------------
// exam
// ---------------------------------------------------------------------------

define(ExamSettingsSchema, 'ExamSettings', 'Exam-level behaviour: timeLimitMinutes 1–600, attemptsAllowed 1–20, passPercent 0–100, navigation "free"|"sequential", layout, review visibility, optional availability window. Only set what the author asked for; never invent dates.');
define(ExamSectionSchema, 'ExamSection', 'A section of an exam: {"id","title","instructions"?,"timeLimitMinutes"?,"questions":[…]} with 1–200 entries. If any section has timeLimitMinutes, every section must.');
field(ExamSettingsSchema, 'timeLimitMinutes', 'Whole exam time limit in minutes, 1–600.');
field(ExamSettingsSchema, 'passPercent', 'Passing threshold in percent, 0–100.');
field(ExamSettingsSchema, 'review', 'When learners may see score, correct answers and explanations: each of showScore, showCorrectAnswers, showExplanations is "immediately", "on_release" or "never".');
field(ExamSettingsSchema, 'availability', 'Optional open/close window as ISO 8601 date-times. Omit unless the author gave concrete dates.');

// ---------------------------------------------------------------------------
// course manifest
// ---------------------------------------------------------------------------

define(CompletionRuleSchema, 'CompletionRule', 'One course completion rule, chosen by "type": all_items, lessons_completed, exam_passed, assignment_approved or quiz_min_score.');
define(CourseAccessSchema, 'CourseAccess', 'Who may see the course: {"scope":"global"} or {"scope":"branches","branchIds":[…]}.');
define(ManifestItemSchema, 'ManifestItem', 'An entry in a course module. Either a complete inline item — {"type":"lesson",…blocks} / {"type":"exam",…sections} / {"type":"assignment",…instructions,submission} — or a stub {"type","id","title"?} whose document is supplied separately. Inline items use "type", not "kind", and carry no schemaVersion or $schema. A course JSON meant to be imported on its own must inline every item.');
define(ModuleSchema, 'Module', 'A course module: {"id","title","summary"?,"items":[ManifestItem…]} with 1–60 items.');

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

define(CourseDocumentSchema, 'CourseDocument', 'A whole course: schemaVersion 1, kind "course", id, title, summary, languages, defaultLanguage, level, difficulty, pathway, learningOutcomes, access and modules. "languages" lists the content languages actually provided and must include defaultLanguage.');
define(LessonDocumentSchema, 'LessonDocument', 'A standalone lesson: {"schemaVersion":1,"kind":"lesson","id","title","blocks":[LessonBlock…]}. A practice quiz is a QuizBlock inside "blocks" — there is no "quiz" document kind.');
define(ExamDocumentSchema, 'ExamDocument', 'A standalone exam or test: {"schemaVersion":1,"kind":"exam","id","title","settings"?,"sections":[ExamSection…]}. Questions live in sections[].questions[].');
define(AssignmentDocumentSchema, 'AssignmentDocument', 'A standalone assignment: {"schemaVersion":1,"kind":"assignment","id","title","instructions","submission","rubric"?}.');
define(QuestionBundleSchema, 'QuestionBundle', 'A bank import: {"schemaVersion":1,"kind":"question_bundle","questions":[Question…]}.');
define(ResourceDocumentSchema, 'ResourceDocument', 'A library resource with a content-only "body" (no activities).');
define(NotebookAssignmentSchema, 'NotebookAssignment', 'Optional notebook configuration for a coding assignment; requires uploaded template and dataset assets.');
define(NotebookDatasetSchema, 'NotebookDataset', 'One dataset file attached to a notebook assignment.');

for (const [schema, kind] of [[LessonDocumentSchema, 'lesson'], [ExamDocumentSchema, 'exam'], [AssignmentDocumentSchema, 'assignment'], [CourseDocumentSchema, 'course'], [QuestionBundleSchema, 'question_bundle'], [ResourceDocumentSchema, 'resource']] as const) {
  field(schema, 'schemaVersion', 'Always the number 1.');
  field(schema, 'kind', `Always "${kind}".`);
  field(schema, '$schema', 'Optional URL of the published schema for editor tooling; has no effect on validation.');
}
for (const schema of [LessonDocumentSchema, ExamDocumentSchema, AssignmentDocumentSchema]) {
  field(schema, 'languages', 'Optional list of content languages a standalone item provides. Leave it out unless the target course configuration is known; the course settings win on import.');
  field(schema, 'defaultLanguage', 'Optional default language for a standalone item; must be in "languages".');
}
field(CourseDocumentSchema, 'languages', 'Content languages actually provided in this course (1–2 of "vi", "en"). This is not the learner interface language.');
field(CourseDocumentSchema, 'modules', '1–60 modules, each holding the course items in order.');
field(LessonDocumentSchema, 'blocks', '1–400 LessonBlock entries in reading order.');
field(ExamDocumentSchema, 'sections', '1–20 ExamSection entries; the whole exam may hold at most 200 questions.');
