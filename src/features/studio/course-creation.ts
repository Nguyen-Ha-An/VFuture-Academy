import { z } from 'zod';

import { PATHWAYS } from '@/content-engine/schema/course';
import { IdSchema, L10nStringSchema, LocaleSchema } from '@/content-engine/schema/common';

function hasNonblankTitleForDefaultLanguage(title: z.output<typeof L10nStringSchema>, defaultLanguage: z.output<typeof LocaleSchema>): boolean {
  if (typeof title === 'string') return title.trim().length > 0;
  return typeof title[defaultLanguage] === 'string' && title[defaultLanguage].trim().length > 0;
}

/** The course shell payload accepted consistently by the dialog, API and draft service. */
export const CourseCreationInputSchema = z.object({
  id: IdSchema,
  title: L10nStringSchema,
  languages: z.array(LocaleSchema).min(1).max(2),
  defaultLanguage: LocaleSchema,
  pathway: z.enum(PATHWAYS),
  level: z.enum(['foundation', 'specialization']),
}).strict().superRefine((value, context) => {
  if (!value.languages.includes(value.defaultLanguage)) {
    context.addIssue({
      code: 'custom',
      path: ['defaultLanguage'],
      message: 'defaultLanguage must be one of languages',
    });
  }
  if (!hasNonblankTitleForDefaultLanguage(value.title, value.defaultLanguage)) {
    context.addIssue({
      code: 'custom',
      path: ['title', value.defaultLanguage],
      message: 'title must be nonblank in defaultLanguage',
    });
  }
});

export type CourseCreationInput = z.output<typeof CourseCreationInputSchema>;
