import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ supabaseService: vi.fn() }));

import {
  categoryForPathway,
  declarationsFromCompiledCourse,
  onAssignmentApproved,
  onCourseCompleted,
  onExamPassed,
  passport,
  recordEvidence,
  upsertFromManifest,
} from '@/features/skills/service';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown | null };

class MemoryQuery implements PromiseLike<Result> {
  private filters: Array<(row: Row) => boolean> = [];
  private maximum: number | null = null;
  private resultError: unknown | null = null;

  constructor(
    private readonly database: MemorySkillsDatabase,
    readonly table: string,
  ) {}

  select(_columns: string) { return this; }

  upsert(value: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      const row = entry as Row;
      if (this.table === 'skill_evidence') {
        if (
          this.database.enforceEvidenceForeignKeys
          && !this.database.rows.skills.some((skill) => skill.id === row.skill_id)
        ) {
          this.resultError = { code: '23503', message: 'foreign key violation' };
          continue;
        }
        if (typeof row.skill_id === 'string' && this.database.failingEvidenceSkills.has(row.skill_id)) {
          this.resultError = { code: '23503', message: 'foreign key violation' };
          continue;
        }
        const duplicate = this.database.rows.skill_evidence.some((existing) =>
          ['user_id', 'skill_id', 'evidence_type', 'ref_id'].every((key) => existing[key] === row[key]));
        if (!duplicate) this.database.rows.skill_evidence.push({
          id: `evidence-${this.database.rows.skill_evidence.length + 1}`,
          created_at: '2026-09-03T00:00:00.000Z',
          ...row,
        });
      } else if (this.table === 'skills') {
        const existing = this.database.rows.skills.find((skill) => skill.id === row.id);
        if (existing) {
          if (!options?.ignoreDuplicates) Object.assign(existing, row);
        } else {
          this.database.rows.skills.push({ ...row });
        }
      }
    }
    this.database.upserts.push({ table: this.table, value, options });
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  order(_column: string, _options?: unknown) { return this; }
  limit(value: number) { this.maximum = value; return this; }

  async maybeSingle(): Promise<Result> {
    return { data: this.filtered()[0] ?? null, error: this.resultError };
  }

  async single(): Promise<Result> {
    return { data: this.filtered()[0] ?? null, error: this.resultError };
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.filtered(), error: this.resultError }).then(onfulfilled, onrejected);
  }

  private filtered() {
    const rows = this.database.rows[this.table] ?? [];
    const filtered = rows.filter((row) => this.filters.every((filter) => filter(row)));
    return this.maximum === null ? filtered : filtered.slice(0, this.maximum);
  }
}

class MemorySkillsDatabase {
  readonly rows: Record<string, Row[]> = {
    skills: [],
    skill_evidence: [],
    course_version_outline: [],
  };
  readonly upserts: Array<{ table: string; value: unknown; options?: unknown }> = [];
  readonly failingEvidenceSkills = new Set<string>();
  enforceEvidenceForeignKeys = false;

  from(table: string) {
    this.rows[table] ??= [];
    return new MemoryQuery(this, table);
  }
}

describe('skills service', () => {
  let database: MemorySkillsDatabase;

  beforeEach(() => {
    database = new MemorySkillsDatabase();
  });

  it('upserts manifest declarations with the pathway-derived category', async () => {
    await upsertFromManifest(
      [{ id: 'ai-literacy', name: { vi: 'Hiểu biết AI', en: 'AI literacy' } }],
      categoryForPathway('ai-emerging-technology'),
      { client: database },
    );

    expect(database.rows.skills).toEqual([expect.objectContaining({
      id: 'ai-literacy',
      name: { vi: 'Hiểu biết AI', en: 'AI literacy' },
      category: 'ai',
    })]);
    expect(database.upserts.at(-1)?.options).toEqual({ onConflict: 'id', ignoreDuplicates: true });
  });

  it('does not let later course publishes overwrite shared skill metadata', async () => {
    database.rows.skills.push({ id: 'ai-literacy', name: 'Canonical name', category: 'research' });

    await upsertFromManifest(
      [{ id: 'ai-literacy', name: 'Publisher-controlled name' }],
      categoryForPathway('ai-emerging-technology'),
      { client: database },
    );

    expect(database.rows.skills).toEqual([
      { id: 'ai-literacy', name: 'Canonical name', category: 'research' },
    ]);
  });

  it('records evidence idempotently through the database unique-key contract', async () => {
    await recordEvidence('learner-1', 'ai-literacy', 'applied', 'exam_passed', 'exam_attempt', 'attempt-1', { client: database });
    await recordEvidence('learner-1', 'ai-literacy', 'applied', 'exam_passed', 'exam_attempt', 'attempt-1', { client: database });

    expect(database.rows.skill_evidence).toHaveLength(1);
    expect(database.upserts.at(-1)?.options).toEqual({
      onConflict: 'user_id,skill_id,evidence_type,ref_id',
      ignoreDuplicates: true,
    });
  });

  it('maps course completion, exam passing, and assignment approval to their required levels', async () => {
    database.rows.course_version_outline.push({
      version_id: 'version-1',
      skills: [
        { id: 'ai-literacy', name: 'AI literacy' },
        { id: 'problem-framing', name: 'Problem framing' },
      ],
    });

    await onCourseCompleted({
      user_id: 'learner-1',
      course_id: 'course-1',
      course_version_id: 'version-1',
      completed_at: '2026-09-03T00:00:00.000Z',
    }, { client: database });
    await onExamPassed({
      id: 'attempt-1',
      userId: 'learner-1',
      gradingSnapshot: {
        questions: {
          q1: { skills: ['ai-literacy', 'problem-framing'] },
          q2: { skills: ['ai-literacy'] },
          q3: {},
        },
      },
    }, { client: database });
    await onAssignmentApproved({
      userId: 'learner-1',
      submissionId: 'submission-1',
      skills: ['problem-framing'],
    }, { client: database });

    expect(database.rows.skill_evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ skill_id: 'ai-literacy', level: 'exposed', evidence_type: 'course_completion', ref_type: 'course', ref_id: 'course-1' }),
      expect.objectContaining({ skill_id: 'ai-literacy', level: 'applied', evidence_type: 'exam_passed', ref_type: 'exam_attempt', ref_id: 'attempt-1' }),
      expect.objectContaining({ skill_id: 'problem-framing', level: 'demonstrated', evidence_type: 'assignment_approved', ref_type: 'assignment_submission', ref_id: 'submission-1' }),
    ]));
    expect(database.rows.skill_evidence.filter(({ evidence_type }) => evidence_type === 'exam_passed')).toHaveLength(2);
  });

  it('records evidence for a question skill omitted from manifest declarations', async () => {
    database.enforceEvidenceForeignKeys = true;
    const compiled = {
      skills: [{ id: 'declared-skill', name: 'Declared skill' }],
      items: {
        exam: {
          grading: {
            questions: { q1: { skills: ['undeclared-question-skill'] } },
            assignments: {},
          },
        },
      },
    } as unknown as Parameters<typeof declarationsFromCompiledCourse>[0];
    await upsertFromManifest(
      declarationsFromCompiledCourse(compiled),
      'ai',
      { client: database },
    );

    await onExamPassed({
      id: 'attempt-undeclared',
      userId: 'learner-1',
      gradingSnapshot: {
        questions: { q1: { skills: ['undeclared-question-skill'] } },
      },
    }, { client: database });

    expect(database.rows.skill_evidence).toEqual([
      expect.objectContaining({
        skill_id: 'undeclared-question-skill',
        evidence_type: 'exam_passed',
        ref_id: 'attempt-undeclared',
      }),
    ]);
  });

  it('continues recording later evidence when one skill insert fails and logs a correlation id', async () => {
    database.failingEvidenceSkills.add('missing-skill');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await onExamPassed({
      id: 'attempt-1',
      userId: 'learner-1',
      gradingSnapshot: {
        questions: {
          q1: { skills: ['missing-skill', 'ai-literacy'] },
        },
      },
    }, { client: database });

    expect(database.rows.skill_evidence).toEqual([
      expect.objectContaining({ skill_id: 'ai-literacy', ref_id: 'attempt-1' }),
    ]);
    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[skill-evidence:[0-9a-f-]+\] Unable to record evidence$/),
      expect.objectContaining({
        skillId: 'missing-skill',
        evidenceType: 'exam_passed',
        refId: 'attempt-1',
      }),
    );
    error.mockRestore();
  });

  it('aggregates each skill at its highest level and includes navigable evidence', async () => {
    database.rows.skills.push({ id: 'ai-literacy', name: { vi: 'Hiểu biết AI', en: 'AI literacy' }, category: 'ai' });
    database.rows.skill_evidence.push(
      { id: 'e1', user_id: 'learner-1', skill_id: 'ai-literacy', level: 'applied', evidence_type: 'exam_passed', ref_type: 'exam_attempt', ref_id: 'attempt-1', created_at: '2026-09-02T00:00:00Z' },
      { id: 'e2', user_id: 'learner-1', skill_id: 'ai-literacy', level: 'exposed', evidence_type: 'course_completion', ref_type: 'course', ref_id: 'course-1', created_at: '2026-09-01T00:00:00Z' },
      { id: 'e3', user_id: 'learner-1', skill_id: 'ai-literacy', level: 'demonstrated', evidence_type: 'assignment_approved', ref_type: 'assignment_submission', ref_id: 'submission-1', created_at: '2026-09-03T00:00:00Z' },
    );

    await expect(passport('learner-1', { client: database })).resolves.toEqual([{
      id: 'ai-literacy',
      name: { vi: 'Hiểu biết AI', en: 'AI literacy' },
      category: 'ai',
      level: 'demonstrated',
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: 'e1', href: '/exams/attempts/attempt-1/review' }),
        expect.objectContaining({ id: 'e2', href: '/app/courses/course-1' }),
        expect.objectContaining({ id: 'e3', href: '/assignments/submissions/submission-1' }),
      ]),
    }]);
  });
});
