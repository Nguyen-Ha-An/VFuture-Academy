import { describe, it, expect } from 'vitest';
import { ExamDocumentSchema } from '@/content-engine/schema/exam';
import { CourseDocumentSchema, ManifestItemSchema } from '@/content-engine/schema/course';
import { AssignmentDocumentSchema, QuestionBundleSchema, ResourceDocumentSchema } from '@/content-engine/schema/bundle';
import { detectKind, schemaForKind, DocumentSchema } from '@/content-engine/schema/document';
import { exportJsonSchemas } from '@/content-engine/schema/json-schema';
import { DOCUMENT_KINDS } from '@/content-engine/schema/common';

const rc = (t: string) => ({ blocks: [{ type: 'paragraph', content: [{ text: t }] }] });
const sc = { id: 'q1', type: 'single_choice', content: rc('?'), options: [{ id: 'a', content: rc('A') }, { id: 'b', content: rc('B') }], correctAnswer: 'a' };

describe('exam', () => {
  const exam = { schemaVersion: 1, kind: 'exam', id: 'exam-m1', title: 'Exam', settings: { timeLimitMinutes: 30, attemptsAllowed: 2, scoringPolicy: 'best', passPercent: 70, availability: { openAt: '2026-10-01T00:00:00Z', closeAt: '2026-10-15T23:59:59Z', lateSubmission: 'reject' }, review: { showScore: 'immediately', showCorrectAnswers: 'on_release', showExplanations: 'on_release' }, shuffleQuestions: true, navigation: 'free', layout: 'one_per_page', integrity: { logFocusLoss: true, logPaste: true } }, sections: [{ id: 's1', title: 'Part 1', questions: [sc, { $ref: 'bank:a-1' }, { $pool: { id: 'p1', count: 3, filter: { tags: ['x'] } } }] }] };
  it('accepts a full exam and one with only defaults', () => {
    expect(ExamDocumentSchema.safeParse(exam).success).toBe(true);
    expect(ExamDocumentSchema.safeParse({ schemaVersion: 1, kind: 'exam', id: 'e', title: 'E', sections: [{ id: 's', title: 'S', questions: [sc] }] }).success).toBe(true);
  });
  it('rejects bad enums and empty sections', () => {
    expect(ExamDocumentSchema.safeParse({ ...exam, settings: { ...exam.settings, scoringPolicy: 'median' } }).success).toBe(false);
    expect(ExamDocumentSchema.safeParse({ ...exam, sections: [] }).success).toBe(false);
  });
  it('compares the availability window as instants, not strings', () => {
    const withWindow = (openAt: string, closeAt: string) => ExamDocumentSchema.safeParse({ ...exam, settings: { ...exam.settings, availability: { openAt, closeAt } } }).success;
    expect(withWindow('2026-10-01T00:00:00Z', '2026-10-01T00:00:00.001Z')).toBe(true);
    expect(withWindow('2026-10-15T23:59:59Z', '2026-10-01T00:00:00Z')).toBe(false);
  });
  it('rejects mixed section timers with or without a global deadline', () => {
    const { timeLimitMinutes: _timeLimitMinutes, ...settings } = exam.settings;
    const sections = [
      { ...exam.sections[0], id: 'timed', timeLimitMinutes: 10 },
      { ...exam.sections[0], id: 'untimed' },
    ];

    expect(ExamDocumentSchema.safeParse({ ...exam, settings, sections }).success).toBe(false);
    expect(ManifestItemSchema.safeParse({ type: 'exam', id: 'mixed-exam', title: 'Mixed', settings, sections }).success)
      .toBe(false);
    expect(ExamDocumentSchema.safeParse({ ...exam, settings: exam.settings, sections }).success).toBe(false);
    expect(ExamDocumentSchema.safeParse({
      ...exam,
      settings,
      sections: sections.map((section) => ({ ...section, timeLimitMinutes: 10 })),
    }).success).toBe(true);
  });
});

describe('course manifest', () => {
  const course = { schemaVersion: 1, kind: 'course', id: 'ai-foundations', title: { vi: 'Nền tảng AI', en: 'AI Foundations' }, summary: 'x', languages: ['vi', 'en'], defaultLanguage: 'vi', level: 'foundation', difficulty: 'beginner', pathway: 'ai-emerging-technology', learningOutcomes: ['Explain AI'], access: { scope: 'global' }, skills: [{ id: 'ai-literacy', name: 'AI literacy' }], completion: { rules: [{ type: 'all_items' }, { type: 'exam_passed', examId: 'exam-m1' }], certificate: true }, modules: [{ id: 'm1', title: 'M1', items: [{ type: 'lesson', id: 'l1', title: 'L1', required: true }, { type: 'exam', id: 'exam-m1' }, { type: 'lesson', id: 'inline', title: 'Inline', blocks: [{ type: 'paragraph', content: [{ text: 'x' }] }] }, { type: 'assignment', id: 'final', title: 'Final', instructions: rc('Do'), submission: { accepts: ['link'] } }] }] };
  it('accepts stubs and inline items', () => {
    const r = CourseDocumentSchema.safeParse(course);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
  it('rejects defaultLanguage outside languages, branch scope without ids, self-prereq structurally allowed', () => {
    expect(CourseDocumentSchema.safeParse({ ...course, defaultLanguage: 'en', languages: ['vi'] }).success).toBe(false);
    expect(CourseDocumentSchema.safeParse({ ...course, access: { scope: 'branches', branchIds: [] } }).success).toBe(false);
    expect(ManifestItemSchema.safeParse({ type: 'lesson', id: 'l', blocks: [] }).success).toBe(false);
  });
});

describe('assignment / bundle / resource documents', () => {
  it('accepts each', () => {
  expect(AssignmentDocumentSchema.safeParse({ schemaVersion: 1, kind: 'assignment', id: 'final', title: 'Final', instructions: rc('Build'), submission: { accepts: ['file', 'link'] } }).success).toBe(true);
    expect(QuestionBundleSchema.safeParse({ schemaVersion: 1, kind: 'question_bundle', id: 'b1', languages: ['vi'], defaultLanguage: 'vi', questions: [sc] }).success).toBe(true);
    expect(ResourceDocumentSchema.safeParse({ schemaVersion: 1, kind: 'resource', id: 'cheat', title: 'Cheat sheet', summary: 's', resourceType: 'cheat_sheet', body: rc('Body') }).success).toBe(true);
  });
  it('accepts a notebook assignment, applies the local runtime default, and enforces profile allowlists', () => {
    const base = {
      schemaVersion: 1, kind: 'assignment', id: 'notebook-final', title: 'Notebook', instructions: rc('Analyze'),
      submission: { accepts: ['file'] },
      notebook: {
        templateAssetId: 'asset-template', templateChecksum: 'a'.repeat(64),
        runtimeProfileId: 'python-data-v1', runtimeProfileVersion: '1',
        datasets: [{ assetId: 'asset-data', checksum: 'b'.repeat(64), filename: 'input.csv' }],
      },
    };
    const parsed = AssignmentDocumentSchema.parse(base);
    expect(parsed.notebook?.runtimeMode).toBe('jupyterlite');
    expect(AssignmentDocumentSchema.safeParse({
      ...base,
      notebook: { ...base.notebook, runtimeMode: 'colab_external' },
    }).success).toBe(false);
    expect(AssignmentDocumentSchema.safeParse({
      ...base,
      notebook: {
        ...base.notebook,
        runtimeMode: 'colab_external', runtimeProfileId: 'colab-python-data-v1', colabReason: 'Needs hosted packages',
      },
    }).success).toBe(true);
    const defaultedColab = AssignmentDocumentSchema.parse({
      ...base,
      notebook: {
        runtimeMode: 'colab_external', templateAssetId: 'asset-template', templateChecksum: 'a'.repeat(64),
        colabReason: 'Needs hosted packages',
      },
    });
    expect(defaultedColab.notebook).toMatchObject({
      runtimeProfileId: 'colab-python-data-v1', runtimeProfileVersion: '1', datasets: [],
    });
    expect(AssignmentDocumentSchema.safeParse({
      ...base,
      notebook: { ...base.notebook, runtimeProfileVersion: 'latest' },
    }).success).toBe(false);
  });
  it('resource body rejects activity blocks', () => {
    expect(ResourceDocumentSchema.safeParse({ schemaVersion: 1, kind: 'resource', id: 'r', title: 't', summary: 's', resourceType: 'guide', body: { blocks: [{ id: 'q', type: 'quiz', questions: [sc] }] } }).success).toBe(false);
  });
  it('accepts optional strict resource branch scope and exports it to JSON Schema', () => {
    const resource = { schemaVersion: 1, kind: 'resource', id: 'r', title: 't', summary: 's', resourceType: 'guide', body: rc('Body') };
    expect(ResourceDocumentSchema.safeParse({ ...resource, branchScope: { scope: 'branches', branchIds: ['branch-one'] } }).success).toBe(true);
    expect(ResourceDocumentSchema.safeParse({ ...resource, branchScope: { scope: 'branches', branchIds: ['branch-one'], extra: true } }).success).toBe(false);
    expect(ResourceDocumentSchema.safeParse({ ...resource, branchScope: { scope: 'branches', branchIds: [] } }).success).toBe(false);
    const schema = exportJsonSchemas().resource as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties).toHaveProperty('branchScope');
    expect(schema.required).not.toContain('branchScope');
  });
});

describe('assignment upload capabilities', () => {
  const assignment = (submission: unknown) => ({
    schemaVersion: 1,
    kind: 'assignment',
    id: 'final',
    title: 'Final',
    instructions: rc('Build'),
    submission,
  });

  it('accepts only MIME types and sizes supported by the learner upload endpoint', () => {
    expect(AssignmentDocumentSchema.safeParse(assignment({
      accepts: ['file'], allowedMimeTypes: ['application/zip', 'image/jxl'], maxFileSizeMB: 50,
    })).success).toBe(true);
    expect(AssignmentDocumentSchema.safeParse(assignment({
      accepts: ['file'], allowedMimeTypes: ['application/vnd.example.unsupported'],
    })).success).toBe(false);
    expect(AssignmentDocumentSchema.safeParse(assignment({
      accepts: ['file'], allowedMimeTypes: ['image/x-custom'],
    })).success).toBe(false);
    expect(AssignmentDocumentSchema.safeParse(assignment({
      accepts: ['file'], allowedMimeTypes: ['application/pdf'], maxFileSizeMB: 51,
    })).success).toBe(false);
  });
});

describe('document dispatch and JSON Schema export', () => {
  it('detects kind and maps to a schema', () => {
    expect(detectKind({ kind: 'lesson' })).toBe('lesson');
    expect(detectKind({ kind: 'nope' })).toBeNull();
    expect(schemaForKind('course')).toBe(CourseDocumentSchema);
  });
  it('DocumentSchema accepts any document kind and rejects unknown ones', () => {
    expect(DocumentSchema.safeParse({ schemaVersion: 1, kind: 'lesson', id: 'l1', title: 'L', blocks: [{ type: 'paragraph', content: [{ text: 'x' }] }] }).success).toBe(true);
    expect(DocumentSchema.safeParse({ kind: 'nope' }).success).toBe(false);
  });
  it('exports one JSON Schema per kind with the kind constant', () => {
    const out = exportJsonSchemas();
    for (const kind of DOCUMENT_KINDS) {
      const s = out[kind] as { $schema: string; properties: { kind: { const: string } } };
      expect(s.$schema).toContain('2020-12');
      expect(s.properties.kind.const).toBe(kind);
    }
  });
});
