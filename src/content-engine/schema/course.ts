import { z } from 'zod';
import { envelopeFields, IdSchema, L10nStringSchema, LocaleSchema, MediaRefSchema } from './common';
import { L10nRichContentSchema } from './rich-content';
import { assignmentBodyFields } from './activities';
import { lessonBodyFields } from './lesson';
import { examBodyFields, validateExamTimerConfiguration } from './exam';

export const PATHWAYS = ['ai-emerging-technology', 'research-innovation', 'entrepreneurship-product', 'fintech-economics', 'core-future-skills'] as const;

export const CompletionRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all_items') }).strict(),
  z.object({ type: z.literal('lessons_completed'), lessonIds: z.union([z.literal('all'), z.array(IdSchema).min(1)]) }).strict(),
  z.object({ type: z.literal('exam_passed'), examId: IdSchema }).strict(),
  z.object({ type: z.literal('assignment_approved'), assignmentId: IdSchema }).strict(),
  z.object({ type: z.literal('quiz_min_score'), lessonId: IdSchema, quizId: IdSchema, percent: z.number().min(0).max(100) }).strict(),
]);
export type CompletionRule = z.infer<typeof CompletionRuleSchema>;

export const CourseAccessSchema = z.union([
  z.object({ scope: z.literal('global') }).strict(),
  z.object({ scope: z.literal('branches'), branchIds: z.array(IdSchema).min(1).max(50) }).strict(),
]);
export type CourseAccess = z.infer<typeof CourseAccessSchema>;

const stubFields = { id: IdSchema, title: L10nStringSchema.optional(), summary: L10nStringSchema.optional(), estimatedMinutes: z.number().int().min(1).optional(), required: z.boolean().optional() };
const { title: _lt, summary: _ls, estimatedMinutes: _le, ...lessonRest } = lessonBodyFields;
const { title: _et, ...examRest } = examBodyFields;
const { id: _ai, title: _at, required: _ar, ...assignmentRest } = assignmentBodyFields;
const InlineExamSchema = z.object({ type: z.literal('exam'), ...stubFields, title: L10nStringSchema, ...examRest })
  .strict()
  .superRefine(validateExamTimerConfiguration);

export const ManifestItemSchema = z.union([
  z.object({ type: z.literal('lesson'), ...stubFields, title: L10nStringSchema, ...lessonRest }).strict(),      // inline lesson (has blocks)
  InlineExamSchema,                                                                                             // inline exam (has sections)
  z.object({ type: z.literal('assignment'), ...stubFields, title: L10nStringSchema, ...assignmentRest }).strict(), // inline assignment (has instructions)
  z.object({ type: z.enum(['lesson', 'exam', 'assignment']), ...stubFields }).strict(),                        // stub
]);
export type ManifestItem = z.infer<typeof ManifestItemSchema>;
export const isInlineItem = (i: ManifestItem) => 'blocks' in i || 'sections' in i || 'instructions' in i;

export const ModuleSchema = z.object({ id: IdSchema, title: L10nStringSchema, summary: L10nStringSchema.optional(), items: z.array(ManifestItemSchema).min(1).max(60) }).strict();

export const CourseDocumentSchema = z.object({
  ...envelopeFields('course'),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/).optional(),
  code: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/).optional(),
  title: L10nStringSchema, summary: L10nStringSchema, description: L10nRichContentSchema.optional(), cover: MediaRefSchema.optional(),
  languages: z.array(LocaleSchema).min(1).max(2), defaultLanguage: LocaleSchema,
  level: z.enum(['foundation', 'specialization']), difficulty: z.enum(['beginner', 'intermediate', 'advanced']), pathway: z.enum(PATHWAYS),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(), estimatedMinutes: z.number().int().min(1).optional(),
  learningOutcomes: z.array(L10nStringSchema).min(1).max(20),
  access: CourseAccessSchema, enrollment: z.enum(['open', 'invite']).optional(),
  prerequisites: z.array(z.object({ type: z.literal('course_completion'), courseId: IdSchema }).strict()).max(10).optional(),
  skills: z.array(z.object({ id: IdSchema, name: L10nStringSchema }).strict()).max(30).optional(),
  completion: z.object({ rules: z.array(CompletionRuleSchema).min(1).max(20), certificate: z.boolean().optional() }).strict().optional(),
  modules: z.array(ModuleSchema).min(1).max(60),
  relatedOpportunities: z.array(IdSchema).max(20).optional(),
  instructors: z.array(z.string()).max(20).optional(),
}).strict().refine((c) => c.languages.includes(c.defaultLanguage), { message: 'defaultLanguage must be one of languages', path: ['defaultLanguage'] });
export type CourseDocument = z.infer<typeof CourseDocumentSchema>;
