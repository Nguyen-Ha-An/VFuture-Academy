import { z } from 'zod';

import { IdSchema, L10nStringSchema } from '@/content-engine/schema/common';
import { CourseAccessSchema } from '@/content-engine/schema/course';
import { L10nRichContentSchema } from '@/content-engine/schema/rich-content';

export const OPPORTUNITY_TYPES = [
  'course', 'workshop', 'event', 'research_cohort', 'competition', 'hackathon',
  'project', 'team_opening', 'mentorship', 'leadership_role', 'external_program',
] as const;

const optionalDate = z.string().datetime({ offset: true }).nullable();
const HttpsUrlSchema = z.string().url().refine((value) => new URL(value).protocol === 'https:', {
  message: 'Application URL must use HTTPS',
});
const optionalHttpsUrl = HttpsUrlSchema.nullable();

/** Treats persisted URLs as untrusted and returns only absolute HTTPS links. */
export function safeApplicationUrl(value: unknown): string | null {
  const parsed = HttpsUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const OpportunityFormSchema = z.object({
  id: IdSchema,
  title: L10nStringSchema,
  organization: z.string().trim().min(1).max(160),
  type: z.enum(OPPORTUNITY_TYPES),
  description: L10nRichContentSchema,
  eligibility: z.record(z.string(), z.unknown()),
  recommendedSkills: z.array(IdSchema).max(50),
  recommendedCourses: z.array(IdSchema).max(50),
  requiredCourses: z.array(IdSchema).max(50),
  applicationUrl: optionalHttpsUrl,
  internalApplication: z.boolean(),
  openAt: optionalDate,
  closeAt: optionalDate,
  startAt: optionalDate,
  endAt: optionalDate,
  location: z.string().trim().max(200).nullable(),
  online: z.boolean(),
  branchScope: CourseAccessSchema,
  featured: z.boolean(),
}).strict().superRefine((value, context) => {
  if (!value.internalApplication && !value.applicationUrl) {
    context.addIssue({ code: 'custom', path: ['applicationUrl'], message: 'External opportunities require an application URL' });
  }
  if (value.openAt && value.closeAt && new Date(value.closeAt) < new Date(value.openAt)) {
    context.addIssue({ code: 'custom', path: ['closeAt'], message: 'Close date must be on or after open date' });
  }
  if (value.startAt && value.endAt && new Date(value.endAt) < new Date(value.startAt)) {
    context.addIssue({ code: 'custom', path: ['endAt'], message: 'End date must be on or after start date' });
  }
});

export type OpportunityForm = z.infer<typeof OpportunityFormSchema>;
