import 'server-only';

import { buildPromptPack } from '@/content-engine/prompt-pack';
import { CourseDocumentSchema } from '@/content-engine/schema/course';
import type { Locale, L10nString } from '@/content-engine/schema/common';
import { DocumentSchema } from '@/content-engine/schema/document';
import { ApiError, toValidationIssues } from '@/lib/api';
import type { CourseDraft } from './drafts';

export type StudioPromptKind = 'outline' | 'lesson' | 'exam' | 'quiz' | 'translate';
export type DraftPromptRequest = { kind: StudioPromptKind; itemId?: string; locale: Locale };

function text(value: L10nString | undefined, locale: Locale, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (!value) return fallback;
  return value[locale] ?? value.vi ?? value.en ?? fallback;
}

function itemDocument(draft: CourseDraft, itemId: string | undefined) {
  if (!itemId) throw new ApiError(400, 'ITEM_ID_REQUIRED', 'itemId is required for this prompt kind');
  const result = DocumentSchema.safeParse(draft.items[itemId]);
  if (!result.success || !['lesson', 'exam', 'assignment'].includes(result.data.kind)) {
    throw new ApiError(422, 'ITEM_INVALID', 'Stored item cannot be used to build this prompt', [{ path: [itemId], message: 'Expected a valid course item document' }]);
  }
  return result.data;
}

/** Adapts stored Studio documents to the framework-free engine prompt-pack requests. */
export function buildDraftPrompt(draft: CourseDraft, request: DraftPromptRequest): string {
  const courseResult = CourseDocumentSchema.safeParse(draft.manifest);
  if (!courseResult.success) {
    throw new ApiError(422, 'MANIFEST_INVALID', 'Stored manifest cannot be used to build a prompt', toValidationIssues(courseResult.error.issues));
  }
  const course = courseResult.data;
  const context = { id: course.id, title: text(course.title, request.locale, course.id), languages: course.languages, defaultLanguage: course.defaultLanguage };

  if (request.kind === 'outline') {
    return buildPromptPack({
      kind: 'course_outline',
      locale: request.locale,
      brief: {
        title: text(course.title, request.locale, course.id),
        audience: 'High-school learners (15–18)',
        languages: course.languages,
        defaultLanguage: course.defaultLanguage,
        pathway: course.pathway,
        level: course.level,
        durationHours: Math.max(1, Math.ceil((course.estimatedMinutes ?? 60) / 60)),
        outcomes: course.learningOutcomes.map((outcome) => text(outcome, request.locale)),
      },
    });
  }

  const item = itemDocument(draft, request.itemId);
  if (request.kind === 'translate') {
    return buildPromptPack({
      kind: 'translate',
      locale: request.locale,
      targetLocale: request.locale === 'vi' ? 'en' : 'vi',
      document: item,
    });
  }
  if (request.kind === 'lesson') {
    if (item.kind !== 'lesson') throw new ApiError(409, 'ITEM_KIND_MISMATCH', 'Lesson prompt requires a lesson item');
    return buildPromptPack({
      kind: 'lesson',
      locale: request.locale,
      course: context,
      stub: {
        id: item.id,
        title: text(item.title, request.locale, item.id),
        ...(item.summary ? { summary: text(item.summary, request.locale) } : {}),
        ...(item.objectives ? { objectives: item.objectives.map((objective) => text(objective, request.locale)) } : {}),
        ...(item.estimatedMinutes ? { estimatedMinutes: item.estimatedMinutes } : {}),
      },
    });
  }
  if (request.kind === 'exam') {
    if (item.kind !== 'exam') throw new ApiError(409, 'ITEM_KIND_MISMATCH', 'Exam prompt requires an exam item');
    return buildPromptPack({
      kind: 'exam',
      locale: request.locale,
      course: context,
      stub: { id: item.id, title: text(item.title, request.locale, item.id) },
      coverage: course.learningOutcomes.map((outcome) => text(outcome, request.locale)),
      questionCount: Math.max(1, item.sections.reduce((count, section) => count + section.questions.length, 0)),
      timeLimitMinutes: item.settings?.timeLimitMinutes ?? 30,
    });
  }
  if (item.kind !== 'lesson') throw new ApiError(409, 'ITEM_KIND_MISMATCH', 'Quiz prompt requires a lesson item');
  return buildPromptPack({
    kind: 'quiz',
    locale: request.locale,
    lessonSummary: text(item.summary, request.locale, text(item.title, request.locale, item.id)),
    count: 5,
  });
}
