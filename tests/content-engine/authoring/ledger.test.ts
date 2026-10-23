import { describe, expect, it } from 'vitest';
import { LessonDocumentSchema } from '@/content-engine/schema/lesson';
import { ExamDocumentSchema, ExamSectionSchema } from '@/content-engine/schema/exam';
import { AssignmentDocumentSchema } from '@/content-engine/schema/bundle';
import { AssignmentBlockSchema, QuizBlockSchema } from '@/content-engine/schema/activities';
import { DOCUMENT_FIELD_POLICIES } from '@/content-engine/authoring/ledger';

describe('storage field decision ledger', () => {
  it('accounts for every storage document and placement field', () => {
    const source = {
      lesson: LessonDocumentSchema.shape,
      exam: ExamDocumentSchema.shape,
      assignment: AssignmentDocumentSchema.shape,
      examSection: ExamSectionSchema.shape,
      quizBlock: QuizBlockSchema.shape,
      assignmentBlock: AssignmentBlockSchema.shape,
    };
    for (const [name, shape] of Object.entries(source)) {
      expect(Object.keys(DOCUMENT_FIELD_POLICIES[name as keyof typeof source]).sort()).toEqual(Object.keys(shape).sort());
    }
  });

  it('marks storage-only envelope and notebook fields as forbidden', () => {
    expect(DOCUMENT_FIELD_POLICIES.lesson.$schema).toBe('forbid');
    expect(DOCUMENT_FIELD_POLICIES.exam.languages).toBe('forbid');
    expect(DOCUMENT_FIELD_POLICIES.assignment.notebook).toBe('forbid');
    expect(DOCUMENT_FIELD_POLICIES.assignmentBlock.notebook).toBe('forbid');
    expect(DOCUMENT_FIELD_POLICIES.examSection.timeLimitMinutes).toBe('forbid');
  });
});
